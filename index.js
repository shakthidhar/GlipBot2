require('dotenv').config();

var express = require('express');
var bodyParser = require('body-parser');
var fs = require('fs');
const RC = require('ringcentral');

var app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const PORT = process.env.RINGCENTRAL_PORT;
const CLIENT_ID = process.env.RINGCENTRAL_CLIENT_ID;
const CLIENT_SECRET = process.env.RINGCENTRAL_CLIENT_SECRET;
const RINGCENTRAL_ENV = process.env.RINGCENTRAL_SERVER_URL;
const REDIRECT_HOST = process.env.RINGCENTRAL_REDIRECT_URL;

const HELPER_CLIENT_ID = process.env.GLIP_HELPER_RINGCENTRAL_CLIENT_ID;
const HELPER_CLIENT_SECRET = process.env.GLIP_HELPER_RINGCENTRAL_CLIENT_SECRET;
const HELPER_RINGCENTRAL_ENV = process.env.GLIP_HELPER_RINGCENTRAL_SERVER_URL;
const HELPER_REDIRECT_HOST = process.env.RINGCENTRAL_REDIRECT_URL;

const getBusinessHoursAccount = /^Get Hours [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]/i;
const getCompanyInfoCommand = /^Get company info/i;
const getCompanyTimeZoneCommand = /^Get company time zone/i;
const getBlockedNumbersCommand = /^Get blocked numbers/i;
const getVoicemailSettingsCommand = /^Get voicemail settings/i;
const getInboundFaxesSetingCommand = /^Get in-fax settings/i;
const getOutoundFaxesSettingsCommand = /^Get out-fax settings/i;
const getMissedCallsSettingsCommand = /^Get missed call settings/i;
const getInboundTextsSettingsCommand = /^Get in-text settings/i;

const welcomeMessage = 'Hello!! I am Glip Bot and I can assist you with customizing your RingCentral setting.\n' +
    'Here are a list of commands you could use:\n' +
    '1) Get Company Business Hours: **Get Hours <accountID>** \n' +
    '2) Update Company Business Hours: **Update Hours <Day> <Hours> for <accountID>**\n';

var platform, rcsdk, botID, creatorID, bot_token;
var helper_platform, helper_rcsdk, helper_token, refresh_token, token_expires_in, refresh_token_expires_in, helper_token_type;
var expire_time, refresh_token_expire_time;

rcsdk = new RC({
    server: RINGCENTRAL_ENV,
    appKey: CLIENT_ID,
    appSecret: CLIENT_SECRET
});

platform = rcsdk.platform();

helper_rcsdk = new RC({
    server: HELPER_RINGCENTRAL_ENV,
    appKey: HELPER_CLIENT_ID,
    appSecret: HELPER_CLIENT_SECRET
});

helper_platform = helper_rcsdk.platform();

getToken();


app.listen(PORT, function () {
    //Callback triggered when server is successfully listening. Hurray!
    console.log("Example app listening on port " + PORT);
});


app.get('/', function (req, res) {
    res.send('Ngrok is working! Path Hit: ' + req.url);
});

app.get('/helper_oauth', function (req, res) {
    console.log('Authoring glip helper with code..')
    if (!req.query.code) {
        res.status(500);
        res.send({ "Error": "Looks like we're not getting code." });
        console.log("Looks like we're not getting code.");
    } else {
        helper_platform.login({
            code: req.query.code,
            redirectUri: HELPER_REDIRECT_HOST + '/helper_oauth'
        }).then(function (authResponse) {
            var obj = authResponse.json();
            helper_token = obj.access_token;
            refresh_token = obj.refresh_token;
            token_expires_in = obj.expires_in;
            helper_token_type = obj.token_type;
            refresh_token_expires_in = obj.refresh_token_expires_in;
            expire_time = (obj.expires_in * 1000) + Date.now();
            refresh_token_expire_time = (obj.refresh_token_expires_in * 1000) + Date.now();
            //console.log(obj)
            res.send(obj);
            console.log('Glip Helper authorization successful!!')
            addTokenToHelperPlatform();
            saveHelperToken();
        }).catch(function (e) {
            console.error(e)
            res.send("Error: " + e);
        })
    }
});

//add token info to helper platform
function addTokenToHelperPlatform() {
    var data = helper_platform.auth().data();
    data.token_type = helper_token_type;
    data.access_token = helper_token;
    data.refresh_token = refresh_token;
    data.expires_in = expire_time - Date.now();
    data.expire_time = expire_time;
    data.refresh_token_expires_in = refresh_token_expire_time - Date.now();
    data.refresh_token_expire_time = refresh_token_expire_time;
    helper_platform.auth().setData(data);
    console.log(helper_platform.auth().data().expire_time + " " + Date.now())
}

//Save helper access token to file
function saveHelperToken() {
    var data = helper_platform.auth().data();
    var data = data.access_token + ',' + data.expire_time + ',' + data.refresh_token + ',' + data.refresh_token_expire_time;
    console.log(data)

    fs.writeFile('helper_token_data.csv', data, function (err) {
        if (err) {
            throw err;
        }
        console.log('Saved access token to file.');
    });
}

function validateHelperAccessToken() {

    if (expire_time < Date.now()) {
        if (refresh_token_expire_time < Date.now()) {
            return false;
        } else {
            //console.log(helper_platform.auth().data())
            helper_platform.refresh();
            console.log("Refreshed token")
            saveHelperToken();
            return true;
        }
    }
    return true;
}

function readHelperTokenFromFile() {

    console.log('Loading token from file...')
    try {
        file_data = fs.readFileSync('helper_token_data.csv', 'utf8');
        if (file_data) {
            var token_data = file_data.toString().split(',');
            if (token_data.length == 4) {
                helper_token = token_data[0];
                expire_time = parseInt(token_data[1]);
                refresh_token = token_data[2];
                refresh_token_expire_time = parseInt(token_data[3]);
                helper_token_type = "Bearer";
                addTokenToHelperPlatform();
                return validateHelperAccessToken();
            } else {
                return false;
            }
        } else {
            return false;
        }
    } catch (err) {
        return false
    }
}

app.post('/oauth', function (req, res) {
    bot_token = req.body.access_token;
    creatorID = req.body.creator_extension_id;
    console.log(bot_token);
    res.send({});
    addTokenToPlatform(bot_token);
    saveToken(bot_token);
});

// Callback method received after subscribing to webhook
app.post('/glip/receive', function (req, res) {

    var validationToken = req.get('Validation-Token');

    if (validationToken) {
        console.log('Responding to RingCentral as last leg to create new Webhook');
        res.setHeader('Validation-Token', validationToken);
        res.status(200).json({
            message: 'Set Header Validation'
        });
    } else {
        //console.log(JSON.stringify(req.body));
        res.status(200).send(req.body);
        console.log("EventTpe: " + req.body.body.eventType);
        switch (req.body.body.eventType) {
            case "Delete":
                console.log("Bot Deleted")
                break;
            case "GroupJoined":
                var groupID = req.body.body.id;
                //postMessageOnGlip(groupID, welcomeMessage);
                //sendLoginUrl()
                console.log("Group Joined :" + req.body.body.id);
                //console.log("Group Joined Data Packet: " req.body);
                if (!readHelperTokenFromFile()) {
                    console.log('Failed to load token from file. Log in using url!!')
                    var url = helper_platform.loginUrl()
                    var urlMessage = "Please use the link below to authorize the bot to retrieve"
                        + " and make changes to your RingCentral Settings\n" + url
                    console.log(url)
                    postMessageOnGlip(groupID, urlMessage)
                } else {
                    console.log('Load successful!!');
                }
                break;
            case "PostAdded":
                //console.log("Post Added :" + JSON.stringify(req.body.body));
                console.log("Post added: " + req.body.body.text)
                respondToPosts(req.body.body);
                break;
            default:
                console.log("Default: " + JSON.stringify(req.body));
        }
    }
});

//Posts a message in the glip group
function postMessageOnGlip(groupID, message) {

    platform.post('/restapi/v1.0/glip/groups/' + groupID + "/posts", { "text": message }
    ).then(function () {
        console.log('Successfully posted Message to groupID:' + groupID, '"' + message + '"');
    }).catch(function (e) {
        console.log(e);
        throw e;
    });

}

// Method to Get Bot Information.
function getBotIdentity() {
    platform.get('/account/~/extension/~')
        .then(function (extensionInfo) {
            var identity = JSON.parse(extensionInfo.text());
            console.log("Bot Identity :" + JSON.stringify(identity));
            botID = identity.id;
            subscribeToGlipEvents();
            IsBotAddedToGlip();
        }).catch(function (e) {
            console.error(e);
            throw e;
        })
}


// Method to Subscribe to Glip Events.
function subscribeToGlipEvents() {

    var requestData = {
        "eventFilters": [
            //Get Glip Post Events
            "/restapi/v1.0/glip/posts",
            //Get Glip Group Events
            "/restapi/v1.0/glip/groups",
            // Get Bot Extension Events (used to detect when a bot is removed)
            "/restapi/v1.0/account/~/extension/" + botID
        ],
        "deliveryMode": {
            "transportType": "WebHook",
            "address": REDIRECT_HOST + "/glip/receive"
        },
        "expiresIn": 500000000
    };
    platform.post('/subscription', requestData)
        .then(function (subscriptionResponse) {
            console.log('successfully subscribed to glip events');
            //console.log('Subscription Response: ', subscriptionResponse.json());
        }).catch(function (e) {
            console.error("Error while subscribing." + e);
            throw e;
        });
}

function IsBotAddedToGlip() {
    platform.get('/glip/persons/' + botID)
        .then(function (botInfo) {
            console.log("Bot is Added to Glip");
            //createGroup(); 
        }).catch(function (e) {
            console.log("Waiting for bot to be added to Glip...!");
            setTimeout(function () {
                IsBotAddedToGlip();
            }, 10000);
        })
}

//Save access token to file
function saveToken(access_token) {
    fs.writeFile('bot_token_data.csv', access_token, function (err) {
        if (err) {
            throw err;
        }
        console.log('Saved access token to file.');
    });
}

function getToken() {
    console.log("Loading glip bot token from file...");
    try {
        file_data = fs.readFileSync('bot_token_data.csv', 'utf8');
        access_token = file_data.toString();
        if (access_token) {
            console.log("Load successful")
            addTokenToPlatform(access_token);
            return true;
        } else {
            return false;
        }
    } catch (err) {
        console.log(err);
        return false;
    }

}

function addTokenToPlatform(access_token) {
    var data = platform.auth().data();
    data.token_type = "bearer";
    data.expires_in = 500000000;
    data.access_token = access_token;
    platform.auth().setData(data);
    getBotIdentity();
}

//Function to handle commands posted on glip
function respondToPosts(body) {
    var groupID = parseInt(body.groupId);
    var creatorID = parseInt(body.creatorId);
    var messageType = body.type;
    var messageText = body.text;

    if (creatorID != botID && messageType == 'TextMessage') {
        console.log('creator: '+ creatorID+ ' groupID: '+  botID);
        if (messageText == "Hello") {
            postMessageOnGlip(groupID,welcomeMessage)
        } else if (messageText.match(getBusinessHoursAccount)) {

        } else if (messageText.match(getCompanyInfoCommand)) {
            console.log('Geting Company Info')
            postCompanyInfo(groupID);
        } else if (messageText.match(getCompanyTimeZoneCommand)) {
            console.log('Geting Time Zone')
            postCompanyTimeZone(groupID);
        } else if (messageText.match(getBlockedNumbersCommand)) {
            console.log('Geting blocked phone number')
            postBlockedPhoneNumber(groupID);
        }else if(messageText.match(getVoicemailSettingsCommand)){
            console.log('Geting voicemail settings')
            getUserNotificationSettings(groupID,"Voicemail");
        }else if(messageText.match(getInboundFaxesSetingCommand)){
            console.log('Geting in-fax settings')
            getUserNotificationSettings(groupID,getInboundFaxesSetingCommand);
        }else if(messageText.match(getOutoundFaxesSettingsCommand)){
            console.log('Geting out-fax settings')
            getUserNotificationSettings(groupID,"FaxesOut");
        }else if(messageText.match(getInboundTextsSettingsCommand)){
            console.log('Geting in-text settings')
            getUserNotificationSettings(groupID,"TextIn");
        }else if(messageText.match(getMissedCallsSettingsCommand)){
            console.log('Geting in-text settings')
            getUserNotificationSettings(groupID,"MissedCall");
        }else{
            postMessageOnGlip(groupID, 'Invalid Command');
        }
    }
}

//Get and post company Info
function postCompanyInfo(groupID) {

    if (validateHelperAccessToken()) {
        helper_platform.get('/account/~', { 'Authorization': helper_token_type + ' ' + helper_token })
            .then(function (companyInfo) {
                companyInfo = companyInfo.json();
                console.log(companyInfo);

                var messageResponse = 'Company ID: **' + companyInfo.serviceInfo.brand.id + '**\n'
                    + 'Company Name: **' + companyInfo.serviceInfo.brand.name + '**\n'
                    + 'Main Number: **' + companyInfo.mainNumber + '**\n'
                    + 'Comepany Home Country: **' + companyInfo.serviceInfo.brand.homeCountry.name + '**';
                postMessageOnGlip(groupID, messageResponse);

            }).catch(function (e) {
                console.error(e);
                postMessageOnGlip(groupID, "An error has occured while processing your request.");
            });
    } else {
        console.log('Token is invalid')
    }

}

//Get and post Company Time Zone
function postCompanyTimeZone(groupID) {

    helper_platform.get('/account/~', { 'Authorization': helper_token_type + ' ' + helper_token})
        .then(function (companyInfo) {
            companyInfo = companyInfo.json();
            console.log(companyInfo);

            var reagionalSettings = companyInfo.regionalSettings;

            var messageResponse = 'Time Zone: **' + reagionalSettings.timezone.description + '**\n';
            postMessageOnGlip(groupID, messageResponse);

        }).catch(function (e) {
            console.error(e);
            postMessageOnGlip(groupID, "An error has occured while processing your request.");
        });

}

//Get and post blocked phone numbers
function postBlockedPhoneNumber(groupID) {

    helper_platform.get('/account/~/extension/~/caller-blocking/phone-numbers', { 'Authorization': helper_token_type + ' ' + helper_token })
        .then(function (phoneNumbers) {
            phoneNumbers = phoneNumbers.json();
            console.log(phoneNumbers);
            postMessageOnGlip(groupID, "Request Success!");

        }).catch(function (e) {
            console.error(e);
            postMessageOnGlip(groupID, "An error has occured while processing your request.\n"
                + "**" + e + "**");
        });

}

function printBlockedPhoneNumbers() {

    if (validateHelperAccessToken()) {
        helper_platform.get('/account/~/extension/~/caller-blocking/phone-numbers', { 'Authorization': helper_token_type + ' ' + helper_token })
            .then(function (phoneNumbers) {
                phoneNumbers = phoneNumbers.json();
                console.log(phoneNumbers);
            }).catch(function (e) {
                console.error(e);
            });
    } else {
        console.log('Token is invalid')
    }
}

function getUserNotificationSettings(groupID, userRequest) {
    console.log('Getting user notification settings..');

    if (validateHelperAccessToken()) {
        helper_platform.get('/account/~/extension/~/notification-settings', { 'Authorization': helper_token_type + ' ' + helper_token })
            .then(function (notificationSettings) {
                notificationSettings = notificationSettings.json();
                //console.log(notificationSettings);

                switch (userRequest) {
                    case "Voicemail":
                        console.log(getVoicemailSettings(notificationSettings));
                        postMessageOnGlip(groupID, getVoicemailSettings(notificationSettings));
                        break;
                    case "FaxesIn":
                        console.log(getInboundFaxesSeting(notificationSettings));
                        postMessageOnGlip(groupID, getInboundFaxesSeting(notificationSettings));
                        break;
                    case "FaxesOut":
                        console.log(getOutoundFaxesSettings(notificationSettings));
                        postMessageOnGlip(groupID, getOutoundFaxesSettings(notificationSettings));
                        break;
                    case "TextIn":
                        console.log(getInboundTextsSettings(notificationSettings));
                        postMessageOnGlip(groupID, getInboundTextsSettings(notificationSettings));
                        break;
                    case "MissedCall":
                        console.log(getMissedCallsSettings(notificationSettings));
                        postMessageOnGlip(groupID, getMissedCallsSettings(notificationSettings));
                        break;
                }

            }).catch(function (e) {
                console.error(e);
                postMessageOnGlip(groupID, "An error has occured while processing your request.");
            });
    } else {
        console.log('Token is invalid')
    }

}

function getVoicemailSettings(notificationSettings) {

    var message = 'Notify By Email: ' + notificationSettings.voicemails.notifyByEmail
        + '\nNotify By sms: ' + notificationSettings.voicemails.notifyBySms
        + '\nInclude Attachment: ' + notificationSettings.voicemails.includeAttachment
        + '\nMark As Read: ' + notificationSettings.voicemails.markAsRead;

    return message;

}

function getInboundFaxesSeting(notificationSettings) {

    var message = 'Notify By Email: ' + notificationSettings.inboundFaxes.notifyByEmail
        + '\nNotify By sms: ' + notificationSettings.inboundFaxes.notifyBySms
        + '\nInclude Attachment: ' + notificationSettings.inboundFaxes.includeAttachment
        + '\nMark As Read: ' + notificationSettings.inboundFaxes.markAsRead;

    return message;

}

function getOutoundFaxesSettings(notificationSettings) {
    var message = 'Notify By Email: ' + notificationSettings.outboundFaxes.notifyByEmail
        + '\nNotify By sms: ' + notificationSettings.outboundFaxes.notifyBySms

    return message;
}

function getInboundTextsSettings(notificationSettings) {
    var message = 'Notify By Email: ' + notificationSettings.inboundTexts.notifyByEmail
        + '\nNotify By sms: ' + notificationSettings.inboundTexts.notifyBySms

    return message;
}

function getMissedCallsSettings(notificationSettings) {
    var message = 'Notify By Email: ' + notificationSettings.missedCalls.notifyByEmail
        + '\nNotify By sms: ' + notificationSettings.missedCalls.notifyBySms

    return message;
}
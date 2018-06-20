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

const getBusinessHoursAccount = /^Get Hours [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]/i;
const getCompanyInfoCommand = /^Get company info/i;
const getCompanyTimeZoneCommand = /^Get company time zone/i;
const getBlockedNumbersCommand = /^Get blocked numbers/i;

const welcomeMessage = 'Hello!! I am Glip Bot and I can assist you with customizing your RingCentral setting.\n' +
    'Here are a list of commands you could use:\n' +
    '1) Get Company Business Hours: **Get Hours <accountID>** \n' +
    '2) Update Company Business Hours: **Update Hours <Day> <Hours> for <accountID>**\n';

var platform, rcsdk, botID, creatorID, bot_token;

rcsdk = new RC({
    server: RINGCENTRAL_ENV,
    appKey: CLIENT_ID,
    appSecret: CLIENT_SECRET
});

platform = rcsdk.platform();


app.listen(PORT, function () {
    //Callback triggered when server is successfully listening. Hurray!
    console.log("Example app listening on port " + PORT);
});


app.get('/', function (req, res) {
    res.send('Ngrok is working! Path Hit: ' + req.url);
});

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
                postMessageOnGlip(groupID, welcomeMessage);
                console.log("Group Joined :" + req.body.body.id);
                break;
            case "PostAdded":
                console.log("Post Added :" + JSON.stringify(req.body.body));
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
            //console.log("Bot Identity :" + JSON.stringify(identity));
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
            console.error(e);
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

function saveToken(access_token) {
    fs.writeFile('.access_token', access_token, function (err) {
        if (err) {
            throw err;
        }
        console.log('Saved access token to file.');
    });
}

function getToken() {

    access_token = fs.readFile('.access_token', 'utf8', function (err, data) {
        var token = data;
        console.log(token);
        haveValidToken(token);
    });

}

function haveValidToken(access_token) {

    if (access_token == null) {
        console.log("No token on file!!");
        return false;
    }

    var data = platform.auth().data();
    data.token_type = "bearer";
    data.expires_in = 500000000;
    data.access_token = access_token;
    platform.auth().setData(data);
    try {
        getBotIdentity();
    } catch (e) {
        console.log("The token onfile is invalid!!")
    }
}

function addTokenToPlatform(access_token) {
    var data = platform.auth().data();
    data.token_type = "bearer";
    data.expires_in = 500000000;
    data.access_token = access_token;
    platform.auth().setData(data);
    //printBlockedPhoneNumbers();
    getBotIdentity();
}

function respondToPosts(body) {
    var groupID = parseInt(body.groupId);
    var creatorID = parseInt(body.creatorId);
    var messageType = body.type;
    var messageText = body.text;

    if (creatorID != botID && messageType == 'TextMessage') {
        if (messageText.match(getBusinessHoursAccount)) {

        } else if (messageText.match(getCompanyInfoCommand)) {
            console.log('Get Company Info')
            postCompanyInfo(groupID);
        } else if (messageText.match(getCompanyTimeZoneCommand)) {
            console.log('Get Time Zone')
            postCompanyTimeZone(groupID);
        } else if (messageText.match(getBlockedNumbersCommand)) {
            console.log('Get blocked phone number')
            postBlockedPhoneNumber(groupID);
        } else {
            postMessageOnGlip(groupID, 'Invalid Command');
        }
    }
}

function postCompanyInfo(groupID) {

    platform.get('/account/~', { 'Authorization': 'Bearer ' + bot_token })
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

}

function postCompanyTimeZone(groupID) {

    platform.get('/account/~', { 'Authorization': 'Bearer ' + bot_token })
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

function postBlockedPhoneNumber(groupID) {

    platform.get('/account/~/extension/~/caller-blocking/phone-numbers', { 'Authorization': 'Bearer ' + bot_token })
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

function printBlockedPhoneNumbers(){
    platform.get('/account/~/extension/~/caller-blocking/phone-numbers', { 'Authorization': 'Bearer ' + bot_token })
        .then(function (phoneNumbers) {
            phoneNumbers = phoneNumbers.json();
            console.log(phoneNumbers);
            //postMessageOnGlip(groupID, "Request Success!");

        }).catch(function (e) {
            console.error(e);
            //postMessageOnGlip(groupID, "An error has occured while processing your request.\n"
              //  + "**" + e + "**");
        });
}
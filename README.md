# zkSync Element NFT competition: Google Form to Discord Channel

`main.js` is designed to automate the process of managing and processing NFT (Non-Fungible Token) wallet addresses listed in a Google Sheet. It performs the following main tasks:

1. Google Sheets Interaction: Reads wallet addresses from specified columns in a Google Sheet.

2. Fetching NFT Assets: Utilizes [Element's](https://element.market/) API to fetch assets associated with the wallet addresses. It filters these assets based on Mint time.

3. Firebase Database and Storage: Saves asset information, including image URLs, to Firebase.

4. Image Processing: It converts avif files into JPG before being uploaded to Firebase Storage.

5. Google Sheets Updates: Marks rows in the Google Sheet with a status message indicating the completion of processing for each wallet address. It also updates the sheet with URLs to the processed images stored in Firebase.

The script can be run as a one-time operation or scheduled as a recurring task (using a commented-out cron job setup) to regularly check and process new wallet addresses added to the Google Sheet.

## Run locally or on a server with a cron job

You need to set up
- Google Form, and add two Apps Scripts to your Form Sheet. The Webhook you get from your Discord server settings.

```js
function sendImageToDiscordForRow(rowIndex) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  // Adjust the range to specifically include the rows and columns you're interested in to optimize performance
  var lastRow = sheet.getLastRow();
  var range = sheet.getRange(2, 1, lastRow, 26); // Assuming your data starts from row 2 and goes up to column Z
  var values = range.getValues();
  
  // Regular expression to validate the URL format
  var urlPattern = /^(http|https):\/\/[^ "]+$/;
  
  // Column indexes for Q to Z, status column P, starting from 0 (adjusted for the script's 0-based index)
  var startColIndex = 16; // Column Q index (17th column, 0-based)
  var endColIndex = 25; // Column Z index (26th column, 0-based)
  var statusColIndex = 15; // Column P index (16th column, 0-based)

  for (var i = 0; i < values.length; i++) {
    var status = values[i][statusColIndex];
    
    // Proceed only if the status is "Processed"
    if (status === "Processed") {
      var sentToDiscord = false; // Flag to track if any image is sent to Discord from this row

      // Iterate through columns Q to Z for each row
      for (var j = startColIndex; j <= endColIndex; j++) {
        var imageUrl = values[i][j];
        // Check if imageUrl is not empty and is a valid URL
        if (imageUrl && urlPattern.test(imageUrl)) {
          var payload = JSON.stringify({
            embeds: [{
              image: {
                url: imageUrl
              }
            }]
          });

          var options = {
            method: 'post',
            contentType: 'application/json',
            payload: payload,
            muteHttpExceptions: true
          };

          UrlFetchApp.fetch('https://discord.com/api/webhooks/YOUR_WEBHOOK_ID', options);
          sentToDiscord = true;
        }
      }

      // If we've sent at least one image to Discord, mark the status in column P as "Sent to Discord"
      if (sentToDiscord) {
        sheet.getRange(i + 2, statusColIndex + 1).setValue("Sent to Discord"); // i + 2 because rows in the sheet start from 1 and assuming data starts from row 2
      }
    }
  }
}
```

and


```js
function onEdit(e) {
  // Check if the edit is in the correct column range and row range
  var editedRange = e.range;
  var sheet = e.source.getActiveSheet();
  var editedRow = editedRange.getRow();
  var editedCol = editedRange.getColumn();
  
  // Assuming your URLs are in columns Q to Z (columns 17 to 26)
  if (editedCol >= 17 && editedCol <= 26 && editedRow > 1) { // Skip header row
    var status = sheet.getRange(editedRow, 16).getValue(); // Status in column P
    if (status === "Processed") {
      // Call your function to send images
      sendImageToDiscordForRow(editedRow);
    }
  }
}
```

Also in Apps Scripts, set up an Installable Trigger:
1. Click on the clock icon (⏲️) in the left panel to open "Triggers."
2. Click on "+ Add Trigger" in the bottom right corner.
3. Choose onEdit from the "Choose which function to run" dropdown.
4. Select "From spreadsheet" from the "Select event source" dropdown.
5. Choose "On edit" for the event type.
6. Optionally, adjust notifications settings to your preference.
7. Click "Save".

Set up:
- Firebase Realtime Database
- Firebase Storage
- Google cloud console: Credentials 0auth. Download the json into this repo
- Google cloud console: Enable Google Sheets API

To be able to access the Google API you need to make two requests

```
https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=YOUR_CLIENT_ID&scope=https://www.googleapis.com/auth/spreadsheets%20openid%20profile&redirect_uri=YOUR_REDIRECT_URI&access_type=offline&prompt=consent
```

This gets you the Code. Add the code to your env vars, and run it with `node 2getGoogleTOkens.js`.

From there copy the Refresh token and the Access token to your env vars.


In the code, define the timeframe in which NFTs should be minted:

```js
const fromTime = '1708340036'; // Example start time
const toTime = '1710068036'; // Example end time
```

Also in the code, define the columns that hold data. In our example:
`O` has the wallet address,
`P` has the status, and
the script pastes image links starting in column `Q`.

```js
let currentColumn = 'Q';

async function processWalletAddressesFromSheet(sheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth: oAuth2Client,
      spreadsheetId: sheetId,
      range: 'O2:P',
    });
    ...
}

async function markGoogleSheetRowWithStatus(sheetId, rowIndex, statusMessage) {
  const range = `P${rowIndex}`;
  ...
}
```

Now run `main.js` and check your Google Sheet and Discord for the images!

---

## Additional features to add
- Limit time the NFT was minted using https://element.readme.io/reference/get-asset-info


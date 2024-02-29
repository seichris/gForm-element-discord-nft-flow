const { google } = require('googleapis');
const sheets = google.sheets('v4');
const { initializeApp } = require('firebase/app');
const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = require('firebase/storage');
const { getDatabase, ref: dbRef, set, child, get } = require('firebase/database');
const axios = require('axios');
require('dotenv').config();
const puppeteer = require('puppeteer');
const sharp = require('sharp');

let currentColumn = 'Q';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_PRIVATE_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.STORAGE_BUCKET,
  appId: process.env.FIREBASE_CLIENT_ID,
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const storage = getStorage(app);

// Initialize OAuth2 client with your credentials
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Function to get tokens using the authorization code
async function getAccessTokenWithCode(code) {
  try {
    // const { tokens } = await oAuth2Client.getToken(code);
    const tokens = {
      access_token: process.env.GOOGLE_ACCESS_TOKEN,
      refresh_token: process.env.REFRESH_TOKEN,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      token_type: 'Bearer',
      expiry_date: 1709125358719,
    };

    console.log(tokens); // tokens contains access_token, refresh_token, scope, token_type, expiry_date

    // Save the tokens for later use (e.g., in your application's database)
    oAuth2Client.setCredentials(tokens);

    // You can now use oAuth2Client for authenticated requests to Google APIs
  } catch (error) {
    console.error('Error retrieving access token', error);
  }
}

// Replace 'YOUR_AUTHORIZATION_CODE' with the authorization code you received
const authorizationCode = process.env.AUTH_CODE;
getAccessTokenWithCode(authorizationCode);


// Function to mark a row as processed in the Google Sheet
async function markGoogleSheetRowWithStatus(sheetId, rowIndex, statusMessage) {
  const range = `P${rowIndex}`; // Column M for status
  const valueInputOption = 'RAW';
  const requestBody = {
    values: [[statusMessage]],
  };

  try {
    await sheets.spreadsheets.values.update({
      auth: oAuth2Client,
      spreadsheetId: sheetId,
      range,
      valueInputOption,
      resource: requestBody,
    });
    console.log(`Row ${rowIndex} marked as ${statusMessage}.`);
  } catch (error) {
    console.error(`Error marking row as ${statusMessage}:`, error);
  }
}

// Process wallet addresses from Google Sheet
async function processWalletAddressesFromSheet(sheetId, range) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth: oAuth2Client,
      spreadsheetId: sheetId,
      range: 'O2:P', // Adjust the range to include both wallet addresses and status columns
    });

    const rows = response.data.values;
    // if (rows.length) {
    if (response.data.values && response.data.values.length) {
      rows.forEach(async (row, index) => {
        const walletAddress = row[0]; // Wallet address in column L
        const status = row[1]; // Status in column M

        if (status !== "Processed" && status !== "failed - no nfts") {
          // Pass the sheetId and rowIndex to the fetchAssetsAndSaveToFirebase function
          await fetchAssetsAndSaveToFirebase(walletAddress, sheetId, index + 2); // +2 because array is 0-indexed and header row is not included
          await fetchAndProcessImages(sheetId, walletAddress); // Make sure fetchAndProcessImages can handle a single walletAddress
        }
      });
    } else {
      console.log('No data found in the Google Sheet.');
    }
  } catch (err) {
    console.error('The API returned an error: ' + err);
  }
}

const sdk = require('api')('@element/v1.0#1kq2oaflsseygo7');
sdk.auth(process.env.ELEMENT_API_KEY);

// https://element.readme.io/reference/get-asset-info
// https://console.firebase.google.com/u/3/project/rarible-query/database/rarible-query-default-rtdb/data/~2F

async function fetchAssetsAndSaveToFirebase(walletAddress, sheetId, rowIndex) {
  try {
    const response = await sdk.assetsListFromUser({
      chain: 'zksync',
      wallet_address: walletAddress,
      limit: '20'
    });

    if (!response || !response.data || !response.data.data || !response.data.data.assetList || response.data.data.assetList.length === 0) {
      await markGoogleSheetRowWithStatus(sheetId, rowIndex, 'failed - no nfts');
      console.error('No assets found or invalid response for wallet:', walletAddress);
      return;
    }

    const assets = response.data.data.assetList;
    let processedAssets = 0; // Counter for successfully processed assets

    for (const asset of assets) {
      const contractAddress = asset.asset.contractAddress;
      const tokenId = asset.asset.tokenId;
      const preImageUrl = asset.asset.imagePreviewUrl;

      const fromTime = '1708340036'; // Example start time
      const toTime = '1710068036'; // Example end time
      const eventsResponse = await sdk.assetEvents({
        chain: 'zksync',
        contract_address: contractAddress,
        token_id: tokenId,
        limit: '20',
        from_time: fromTime,
        to_time: toTime,
      });

      if (eventsResponse.data && eventsResponse.data.data && eventsResponse.data.data.assetEventList && eventsResponse.data.data.assetEventList.length > 0) {
        const mintEvent = eventsResponse.data.data.assetEventList.find(event => event.assetEvent && event.assetEvent.eventName === "Minted");
        if (mintEvent && mintEvent.assetEvent && preImageUrl) {
          console.log(`Mint event found for asset, processing...`);
          console.log(`Saving preview image URL: ${preImageUrl}`);
          const dataToSave = { preImageUrl: preImageUrl, contractAddress: contractAddress, tokenId: tokenId };

          await set(dbRef(database, `nftImages/${walletAddress}/${rowIndex}/entry${processedAssets + 1}`), dataToSave);
          console.log("Image URL(s) saved successfully.");
          processedAssets++;
        } else {
          console.log(`No mint event found for asset within the specified time range or preview image URL is undefined.`);
        }
      } else {
        console.log(`No asset events found or invalid response structure for asset with tokenId: ${tokenId}`);
      }
    }

    // Check if at least one asset was processed successfully
    if (processedAssets > 0) {
      await markGoogleSheetRowWithStatus(sheetId, rowIndex, 'Processed');
      console.log(`Row ${rowIndex} marked as Processed.`);
    } else {
      await markGoogleSheetRowWithStatus(sheetId, rowIndex, 'failed - no nfts');
      console.error(`No assets processed successfully for wallet: ${walletAddress}`);
    }
  } catch (error) {
    console.error("Error fetching assets or saving data: ", error);
    await markGoogleSheetRowWithStatus(sheetId, rowIndex, 'failed - no nfts');
  }
}



// Function to fetch image URLs from Firebase and process them

async function fetchAndProcessImages(sheetId, walletAddress) {
  currentColumn = 'Q';

  const walletRef = dbRef(database, `nftImages/${walletAddress}`);
  // console.log(`Fetching images for walletAddress: ${walletAddress}`);

  try {
    const walletSnapshot = await get(walletRef);
    if (walletSnapshot.exists()) {
      const walletData = walletSnapshot.val(); // This will contain all rows for the walletAddress

      // Iterate over each rowIndex
      for (const rowIndex in walletData) {
        const row = walletData[rowIndex];
        // Assuming each row contains entries
        for (const entryKey in row) {
          const entry = row[entryKey];
          const imageUrls = [entry.preImageUrl, entry.imageUrl].filter(Boolean); // Filter out any undefined values

          if (imageUrls.length > 0) {
            // Here, rowIndex is directly used from the iteration
            // Convert rowIndex from string (if necessary) and adjust according to your row indexing in Sheets
            const adjustedRowIndex = parseInt(rowIndex, 10); // Adjust if your rowIndex needs conversion
            await convertAndUploadImages(walletAddress, imageUrls, sheetId, adjustedRowIndex);
          }
        }
        // Assuming you want to reset currentColumn after processing each rowIndex,
        // If it's after each wallet, move this outside of the rowIndex loop.
        currentColumn = 'Q'; // Reset currentColumn to 'N' after processing each row or wallet
      }
    } else {
      console.log('No data found for walletAddress:', walletAddress);
    }
  } catch (error) {
    console.error("Error fetching or processing images: ", error);
  }
}

// Function to convert image URLs to images and upload to Firebase
async function convertAndUploadImages(walletAddress, imageUrls, sheetId, rowIndex) {
  console.log(`Starting image conversion and upload for wallet: ${walletAddress} with images:`, imageUrls);
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--window-position=0,0',
      '--ignore-certifcate-errors',
      '--ignore-certifcate-errors-spki-list'
    ]
  });

  // const startColumn = 'N'; // Starting column for image URLs
  // let currentColumnCharCode = startColumn.charCodeAt(0);
  let accumulatedImageUrls = [];

  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    console.log(`Processing image URL: ${imageUrl}`);
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3');
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(imageUrl, { waitUntil: 'networkidle2' });

    const imageBuffer = await page.screenshot();
    // console.log(`Screenshot taken for ${imageUrl}`);

    // Convert image to jpg using sharp
    const outputBuffer = await sharp(imageBuffer)
      .toFormat('jpg')
      .toBuffer();

    // Upload the image to Firebase Storage and get the public URL
    const fileName = `${walletAddress}_${i}_${Date.now()}.jpg`;
    // console.log(`Uploading converted image to Firebase: ${fileName}`);
    const publicImageUrl = await uploadImageToFirebase(outputBuffer, fileName);

    if (publicImageUrl) {
      // console.log(`Uploaded and received URL: ${publicImageUrl}`);
      accumulatedImageUrls.push(publicImageUrl);
    } else {
      // console.log(`Failed to upload image: ${fileName}`);
    }

    await page.close();
  }

  await browser.close();

  // Now call updateSheetWithImageUrls once with all the accumulated URLs
  if (accumulatedImageUrls.length > 0) {
    // console.log(`Completed uploads. Updating sheet with URLs for rowIndex: ${rowIndex}`);
    // console.log(`Updating sheet with accumulated URLs:`, accumulatedImageUrls);
    await updateSheetWithImageUrls(sheetId, rowIndex, accumulatedImageUrls);
  } else {
    console.log(`No images were uploaded successfully for wallet: ${walletAddress}`);
  }
}

async function uploadImageToFirebase(imageBuffer, fileName) {
  // const storage = getStorage();
  const fileRef = storageRef(storage, `images/${fileName}`); // Correctly create a reference to your file in Storage
    try {
        const uploadResult = await uploadBytes(fileRef, imageBuffer); // Upload the file
        const downloadURL = await getDownloadURL(uploadResult.ref); // Get the file's download URL
        console.log("File uploaded and URL:", downloadURL);
        return downloadURL; // Return the download URL
    } catch (error) {
        console.error("Error uploading image to Firebase Storage:", error);
        if (error.customData && error.customData.serverResponse) {
          // console.log("Server Response:", error.customData.serverResponse);
        }
        // console.log(`Error Code: ${error.code}`);
        // console.log(`Error Message: ${error._baseMessage}`);
        // console.log(`HTTP Status Code: ${error.status_}`);
        // console.error("Full error object:", error);
        return null; // Handle error appropriately
    }
}

async function updateSheetWithImageUrls(sheetId, rowIndex, imageUrls, startColumn = 'N') {
  // console.log(`sheetId: ${sheetId}, rowIndex: ${rowIndex}, imageUrls:`, imageUrls);
  const valueInputOption = 'RAW';

  // let currentColumnCharCode = startColumn.charCodeAt(0);

  try {
    for (const imageUrl of imageUrls) {
      // const range = `${String.fromCharCode(currentColumnCharCode)}${rowIndex}`;
      const range = `${currentColumn}${rowIndex}`;
      // console.log(`Attempting to update cell ${range} with image URL: ${imageUrl}`);
      
      const requestBody = {
        values: [[imageUrl]],
      };

      // console.log(`Attempting to update cell ${range} with image URL: ${imageUrl}`);
      try {

        await sheets.spreadsheets.values.update({
          auth: oAuth2Client,
          spreadsheetId: sheetId,
          range,
          valueInputOption,
          resource: requestBody,
        });

        currentColumn = String.fromCharCode(currentColumn.charCodeAt(0) + 1);
      } catch (updateError) {
        console.error(`Error updating cell ${range} with image URL:`, updateError.message);
        // Decide what to do in case of an error.
        // For example, you can break the loop if you don't want to attempt further updates,
        // or continue to try the next URL with the same or next column.
        break; // This stops trying to update more columns on error, replace with `continue;` if you prefer to try the next column
      }
    }
  } catch (error) {
    console.error("Error updating sheet with image URLs:", error);
  }
}

processWalletAddressesFromSheet(process.env.GOOGLE_SHEET_ID, 'Form Responses 1!L:L');

// const cron = require('node-cron');
// // // Cron job runs every hour
// // cron.schedule('*/30 * * * *', () => {
// // Cron job runs every 30 mins
// cron.schedule('0 * * * *', () => {
//   console.log('Checking for new rows in the Google Sheet...');
//   processWalletAddressesFromSheet(process.env.GOOGLE_SHEET_ID, 'Form Responses 1!L:L');
// });

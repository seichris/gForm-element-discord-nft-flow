const axios = require('axios');
require('dotenv').config();

axios.post('https://oauth2.googleapis.com/token', {
  code: process.env.AUTH_CODE,
  client_id: process.env.CLIENT_ID,
  client_secret: process.env.CLIENT_SECRET,
  redirect_uri: process.env.REDIRECT_URI,
  grant_type: 'authorization_code'
})
.then(response => {
  console.log(response.data);
})
.catch(error => {
  console.error(error);
});
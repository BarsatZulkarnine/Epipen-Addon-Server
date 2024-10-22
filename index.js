require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const admin = require('firebase-admin');
const mammoth = require('mammoth'); // Import mammoth for .docx file handling

const app = express();
const port = process.env.PORT || 3000; // Use PORT from environment variables

// Load Firebase credentials from environment variables
const firebaseCredentials = JSON.parse(process.env.FIREBASE_CREDENTIALS);

const firebaseConfig = {
  credential: admin.credential.cert(firebaseCredentials),
  databaseURL: process.env.DATABASE_URL
};

// Initialize Firebase
admin.initializeApp(firebaseConfig);

const db = admin.firestore();

app.use(bodyParser.json());

// Root endpoint to check if the server is running
app.get('/', (req, res) => {
  res.send('The server is running successfully!');
});

// Endpoint to handle alert from ESP32 (GET and POST)
app.post('/alert', handleAlert);
app.get('/alert', handleAlert);

async function handleAlert(req, res) {
  const uid = req.body.uid || req.query.uid; // Get uid from request body or query parameters

  if (!uid) {
    return res.status(400).send({ error: 'UID is required in the request body or query parameters.' });
  }

  try {
    // Fetch data from Firebase using UID
    const docRef = db.collection('userData').doc(uid);
    const doc = await docRef.get();

    if (doc.exists) {
      const data = doc.data();

      // Check if there are any files to summarize
      if (data.files && data.files.length > 0) {
        const fileUrl = data.files[0]; // Assuming you want to summarize the first file
        const fileContent = await downloadAndExtractText(fileUrl);
        
        // Call OpenAI API to summarize the text
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: `Summarize this medical information in bullet points: ${fileContent}` },
            ],
            max_tokens: 200
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
          }
        );

        console.log('OpenAI Response:', openaiResponse.data);

        if (openaiResponse.data.choices && openaiResponse.data.choices.length > 0) {
          // Extract summary and format it as bullet points
          const summary = openaiResponse.data.choices[0].message.content.trim();
          const formattedSummary = formatAsBulletPoints(summary);

          res.send({
            message: 'Data processed successfully',
            summary: formattedSummary
          });
        } else {
          res.status(500).send({ error: 'Unexpected response structure from OpenAI.' });
        }
      } else {
        res.status(404).send({ message: 'No files found for this UID.' });
      }
    } else {
      res.status(404).send({ message: 'No user data found for this UID' });
    }
  } catch (error) {
    console.error('Error fetching data or contacting OpenAI:', error);
    res.status(500).send({ error: 'An error occurred while fetching data or contacting OpenAI.' });
  }
}

// Function to format the summary as bullet points
function formatAsBulletPoints(text) {
  // Split the text into lines
  const lines = text.split('\n').filter(line => line.trim() !== ''); // Remove empty lines
  // Format each line as a bullet point
  return lines.map(line => `• ${line}`).join('\n');
}

// Function to download and extract text from the .docx file
async function downloadAndExtractText(fileUrl) {
  try {
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const result = await mammoth.extractRawText({ buffer: buffer });
    return result.value; // The extracted text
  } catch (error) {
    console.error('Error downloading or extracting text from file:', error);
    throw new Error('Failed to extract text from the file.');
  }
}

app.listen(port, () => {
  console.log(`Backend server is running on  http://localhost:${port}`);
});

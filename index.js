// index.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { YoutubeTranscript } = require('youtube-transcript');
const { HfInference } = require('@huggingface/inference');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Initialize Hugging Face Inference with your API token from the .env file
const hf = new HfInference(process.env.HUGGING_FACE_API_TOKEN);

// Function to extract YouTube video ID from various URL formats
function extractVideoID(url) {
  const urlObj = new URL(url);
  let videoId = urlObj.searchParams.get('v');

  if (!videoId) {
    // Handle URLs like youtu.be/VIDEO_ID
    const paths = urlObj.pathname.split('/');
    videoId = paths[paths.length - 1];
  }

  return videoId;
}

// Function to split transcript into chunks within model input size limitations
function splitTranscript(transcript, maxTokens = 300) {
  const words = transcript.split(' ');
  const chunks = [];
  for (let i = 0; i < words.length; i += maxTokens) {
    chunks.push(words.slice(i, i + maxTokens).join(' '));
  }
  return chunks;
}

// Function to delay between API calls (to prevent rate limiting)
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post('/summarize', async (req, res) => {
  const videoURL = req.body.url;
  if (!videoURL) {
    return res.status(400).send({ error: 'No video URL provided.' });
  }

  try {
    const videoId = extractVideoID(videoURL);

    // Fetch the transcript
    let transcriptArray;
    try {
      transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (transcriptError) {
      console.error('Error fetching transcript:', transcriptError);
      return res.status(404).send({ error: 'Transcript not available for this video.' });
    }

    const transcript = transcriptArray.map(item => item.text).join(' ');

    // Split the transcript into chunks
    const transcriptChunks = splitTranscript(transcript, 300);
    const summaries = [];

    // Summarize each chunk
    for (const chunk of transcriptChunks) {
      try {
        const summaryResponse = await hf.summarization({
          model: 'facebook/bart-large-cnn',
          inputs: chunk,
          parameters: { max_length: 150, min_length: 50 },
        });
        summaries.push(summaryResponse.summary_text);
      } catch (summarizationError) {
        console.error('Error during summarization:', summarizationError);
        return res.status(500).send({ error: 'An error occurred during summarization.' });
      }
      await delay(500); // Optional delay to prevent rate limiting
    }

    // Combine and re-summarize the summaries
    const combinedSummaries = summaries.join(' ');
    const finalSummaryResponse = await hf.summarization({
      model: 'facebook/bart-large-cnn',
      inputs: combinedSummaries,
      parameters: { max_length: 200, min_length: 100 },
    });
    const finalSummary = finalSummaryResponse.summary_text;

    res.send({ summary: finalSummary });
  } catch (error) {
    console.error('Error processing request:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    res.status(500).send({ error: 'An error occurred on the server.' });
  }
});

app.listen(5001, () => {
  console.log('Server running on port 5001');
});

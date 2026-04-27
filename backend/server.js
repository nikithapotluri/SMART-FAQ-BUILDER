const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
require("dotenv").config();
const axios = require("axios");

const upload = multer({ dest: "uploads/" });

const app = express();

app.use(cors());
app.use(express.json());

// Store chunks for RAG
let documentChunks = [];

/*
  Extract JSON safely
*/
function extractJSON(text) {
  try {
    // Extract JSON array if extra text exists
    const match = text.match(/\[[\s\S]*\]/);
    const jsonText = match ? match[0] : text;

    // Clean escaped characters
    const cleaned = jsonText
      .replace(/\\"/g, '"')
      .replace(/\n/g, " ")
      .trim();

    let parsed = JSON.parse(cleaned);

    // Handle double-string JSON
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }

    return parsed;

  } catch {
    throw new Error("Invalid JSON");
  }
}

/*
  Normalize FAQs into array
*/
function normalizeFAQs(faqs) {
  try {
    while (typeof faqs === "string") {
      faqs = faqs.replace(/\\"/g, '"');
      faqs = JSON.parse(faqs);
    }

    if (!Array.isArray(faqs)) {
      return [faqs];
    }

    return faqs;

  } catch {
    return [
      {
        question: "Parsing Error",
        answer: typeof faqs === "string" ? faqs : JSON.stringify(faqs),
      },
    ];
  }
}

/*
  Split text into chunks (RAG)
*/
function splitText(text, chunkSize = 500) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// Test route
app.get("/", (req, res) => {
  res.send("Smart FAQ Builder API is running");
});

/*
  Upload PDF → Generate FAQs + store chunks
*/
app.post("/upload-pdf", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;

    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);

    const text = pdfData.text;

    // Store chunks for RAG
    // 🔥 CLEAR old document first
    documentChunks = [];

    // 🔥 Store new chunks
    documentChunks = splitText(text);

    const trimmedText = text.slice(0, 3000);

    const prompt = `
Generate 10 FAQs from the following content.

Return ONLY a JSON array.

Content:
${trimmedText}
`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "meta-llama/llama-3-8b-instruct",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const output = response.data.choices[0].message.content;

    // Clean
    const cleaned = output
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // Extract JSON array
    const match = cleaned.match(/\[[\s\S]*\]/);
    const finalText = match ? match[0] : cleaned;

    let faqs;

    try {
      faqs = extractJSON(finalText);
    } catch {
      faqs = finalText;
    }

    faqs = normalizeFAQs(faqs);

    fs.unlinkSync(filePath);

    res.json({ faqs });

  } catch (error) {
    console.error("PDF ERROR:", error.message);

    res.status(500).json({
      error: "Something went wrong",
    });
  }
});

/*
  Generate FAQs from text
*/
app.post("/generate-faq", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    const prompt = `
Generate 10 FAQs from the following content.

Return ONLY a JSON array.

Content:
${text}
`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "meta-llama/llama-3-8b-instruct",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const output = response.data.choices[0].message.content;

    // Clean
    const cleaned = output
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // 🔥 IMPORTANT FIX
    const match = cleaned.match(/\[[\s\S]*\]/);
    const finalText = match ? match[0] : cleaned;

    let faqs;

    try {
      faqs = extractJSON(finalText);
    } catch {
      faqs = finalText;
    }

    faqs = normalizeFAQs(faqs);

    res.json({ faqs });

  } catch (error) {
    console.error("ERROR:", error.message);

    res.status(500).json({
      error: "Something went wrong",
    });
  }
});

/*
  Ask question using RAG
*/
app.post("/ask-question", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

    if (!documentChunks.length) {
      return res.status(400).json({
        error: "No document uploaded yet",
      });
    }

    const words = question
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, "") // remove punctuation
  .split(" ")
  .filter(word => word.length > 2); // remove small useless words

const rankedChunks = documentChunks
  .map(chunk => {
    const chunkText = chunk.toLowerCase();

    let score = 0;

    words.forEach(word => {
      if (chunkText.includes(word)) {
        score += 1;
      }
    });

    return { chunk, score };
  })
  .filter(item => item.score > 0) // 🔥 remove irrelevant chunks
  .sort((a, b) => b.score - a.score);
  if (!rankedChunks.length) {
  return res.json({
    answer: "Answer not found in the uploaded document."
  });
}

    const context = rankedChunks
      .slice(0, 3)
      .map(c => c.chunk)
      .join("\n");

    const prompt = `
Answer using ONLY the context.

Context:
${context}

Question:
${question}
`;

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "meta-llama/llama-3-8b-instruct",
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const answer = response.data.choices[0].message.content;

    res.json({ answer });

  } catch (error) {
    console.error("ASK ERROR:", error.message);

    res.status(500).json({
      error: "Something went wrong",
    });
  }
});

// Start server
app.listen(5000, () => {
  console.log("Server running on port 5000");
});
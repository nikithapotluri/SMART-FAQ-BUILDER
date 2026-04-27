import React, { useState } from "react";
import "./App.css";

function App() {
  const [faqs, setFaqs] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");

  // Upload PDF → Generate FAQs
  const uploadPDF = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    setLoading(true);

    const res = await fetch("http://localhost:5000/upload-pdf", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setFaqs(data.faqs || []);
    setLoading(false);
  };

  // Ask question (RAG)
  const askQuestion = async () => {
    if (!question.trim()) {
      alert("Please enter a question!");
      return;
    }

    setLoading(true);

    const res = await fetch("http://localhost:5000/ask-question", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
    });

    const data = await res.json();
    setAnswer(data.answer);
    setLoading(false);
  };

return (
  <div className="container">
    <header className="header">
      <h1>Smart FAQ Builder</h1>
      <p>Upload a PDF and instantly generate FAQs with AI</p>
    </header>

    <div className="grid">
      
      {/* Upload Section */}
      <div className="card">
        <h2>Upload PDF</h2>

        <input type="file" accept="application/pdf" onChange={uploadPDF} />

        {fileName && <p className="fileName">📎 {fileName}</p>}
      </div>

      {/* Ask Question */}
      <div className="card">
        <h2>Ask from Document</h2>

        <input
          className="input"
          placeholder="Ask something about the PDF..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />

        <button onClick={askQuestion} disabled={!question.trim()}>
          Ask
        </button>

        {answer && (
          <div className="answerBox">
            <strong>Answer:</strong>
            <p>{answer}</p>
          </div>
        )}
      </div>

      {/* FAQ Section (Full Width) */}
      <div className="card full">
        <h2>Generated FAQs</h2>

        {loading && <p className="loading">Processing PDF...</p>}

        {!faqs.length && !loading && (
          <p className="empty">No FAQs yet. Upload a PDF to generate.</p>
        )}

        <div className="faqGrid">
          {faqs.map((faq, index) => (
            <div key={index} className="faq">
              <p className="question">Q: {faq.question}</p>
              <p className="answer">A: {faq.answer}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  </div>
);
}

export default App;
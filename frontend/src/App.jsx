import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [maxPages, setMaxPages] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const handleScrape = async (e) => {
    e.preventDefault();
    
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await axios.post('/api/scrape', {
        url: url.trim(),
        maxPages: parseInt(maxPages)
      });

      if (response.data.success) {
        setResult(response.data.data);
      } else {
        setError(response.data.errors?.join(', ') || 'Scraping failed');
      }
    } catch (err) {
      if (err.response?.data?.errors) {
        const errors = err.response.data.errors;
        setError(Array.isArray(errors) ? errors.join(', ') : String(errors));
      } else if (err.response?.data?.error) {
        const error = err.response.data.error;
        setError(typeof error === 'object' ? (error.message || JSON.stringify(error)) : String(error));
      } else {
        setError(err.message || 'An error occurred while scraping');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!result) return;
    
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scraped-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <div className="container">
        {/* Header */}
        <header className="header">
          <h1>🔍 Website Scraper</h1>
          <p>Extract content from any public website into structured JSON</p>
        </header>

        {/* Scraper Form */}
        <form className="scraper-form" onSubmit={handleScrape}>
          <div className="input-group">
            <label htmlFor="url">Website URL</label>
            <input
              type="url"
              id="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="input-group small">
            <label htmlFor="maxPages">Max Pages</label>
            <select
              id="maxPages"
              value={maxPages}
              onChange={(e) => setMaxPages(e.target.value)}
              disabled={loading}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'page' : 'pages'}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-scrape" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner"></span>
                Scraping...
              </>
            ) : (
              '🚀 Start Scraping'
            )}
          </button>
        </form>

        {/* Error State */}
        {error && (
          <div className="error-message">
            <span>⚠️</span>
            <p>{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>Scraping website content...</p>
            <small>This may take a few moments</small>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="results">
            <div className="results-header">
              <div className="site-info">
                <h2>{result.siteTitle || 'Scraped Content'}</h2>
                <a href={result.baseUrl} target="_blank" rel="noopener noreferrer">
                  {result.baseUrl}
                </a>
                <span className="page-count">
                  📄 {result.pages?.length || 0} pages scraped
                </span>
              </div>

              <div className="results-actions">
                <button className="btn-download" onClick={handleDownloadJson}>
                  ⬇️ Download JSON
                </button>
              </div>
            </div>

            <div className="json-content">
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

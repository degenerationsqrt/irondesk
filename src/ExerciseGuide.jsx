import React, { useMemo, useState } from "react";
import {
  CHATGPT_EXERCISE_URL,
  buildExerciseChatPrompt,
  createExerciseGuideCatalog,
  normalizeExerciseName,
  searchExerciseGuides,
} from "./exerciseGuide.js";

const GUIDE_QUERY_KEY = "irondesk:exercise-guide-query";

function initialQuery() {
  try {
    return sessionStorage.getItem(GUIDE_QUERY_KEY) || "";
  } catch {
    return "";
  }
}

function fallbackCopy(text) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Copy failed");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      fallbackCopy(text);
      return;
    }
  }
  fallbackCopy(text);
}

export function ExerciseGuide({ items, activeExerciseNames = [], note, onReturnToWorkout }) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedKey, setSelectedKey] = useState("");
  const [question, setQuestion] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const catalog = useMemo(() => createExerciseGuideCatalog(items), [items]);
  const activeKeys = useMemo(
    () => new Set(activeExerciseNames.map((name) => normalizeExerciseName(name).toLowerCase())),
    [activeExerciseNames],
  );
  const results = useMemo(() => {
    const matches = searchExerciseGuides(catalog, query);
    return [...matches].sort((a, b) =>
      Number(activeKeys.has(b.key)) - Number(activeKeys.has(a.key))
      || a.name.localeCompare(b.name));
  }, [catalog, query, activeKeys]);
  const selected = results.find((guide) => guide.key === selectedKey) || results[0] || null;

  const updateQuery = (value) => {
    setQuery(value);
    setSelectedKey("");
    setQuestion("");
    setCopyStatus("");
    try {
      sessionStorage.setItem(GUIDE_QUERY_KEY, value);
    } catch {}
  };

  const selectGuide = (guide) => {
    setSelectedKey(guide.key);
    setQuestion("");
    setCopyStatus("");
  };

  const preparePrompt = async () => {
    if (!selected) return;
    try {
      await copyText(buildExerciseChatPrompt(selected, question));
      setCopyStatus("Prompt copied. Paste it into ChatGPT.");
      note?.(`${selected.name} question copied`);
    } catch {
      setCopyStatus("Copy was blocked. Select and copy your question manually.");
    }
  };

  return (
    <section className="exercise-guide" aria-labelledby="exercise-guide-title">
      <header className="exercise-guide-hero">
        <div>
          <span>TRAIN SMARTER</span>
          <h2 id="exercise-guide-title">Exercise How-To</h2>
          <p>Search IronDesk movements for setup, technique cues, and common mistakes.</p>
        </div>
        {onReturnToWorkout ? (
          <button type="button" onClick={onReturnToWorkout}>Return to workout</button>
        ) : null}
      </header>

      <label className="exercise-guide-search">
        <span className="sr-only">Search exercises, muscles, or equipment</span>
        <b aria-hidden="true">⌕</b>
        <input
          type="search"
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Search squat, chest, dumbbells…"
          autoComplete="off"
        />
        {query ? <button type="button" onClick={() => updateQuery("")}>Clear</button> : null}
      </label>

      <div className="exercise-guide-layout">
        <div className="exercise-guide-results" aria-label="Exercise search results">
          <div className="exercise-guide-results-heading">
            <strong>{results.length} movement{results.length === 1 ? "" : "s"}</strong>
            <span>{activeKeys.size ? "Current workout first" : "A–Z"}</span>
          </div>
          <div className="exercise-guide-list">
            {results.map((guide) => (
              <button
                type="button"
                key={guide.key}
                className={selected?.key === guide.key ? "is-active" : ""}
                aria-pressed={selected?.key === guide.key}
                onClick={() => selectGuide(guide)}
              >
                <span>
                  <strong>{guide.name}</strong>
                  <small>{guide.category} · {guide.equipment}</small>
                </span>
                {activeKeys.has(guide.key) ? <b>Today</b> : <i aria-hidden="true">›</i>}
              </button>
            ))}
            {!results.length ? (
              <div className="exercise-guide-empty">
                <strong>No exact match</strong>
                <span>Try a muscle such as “back” or equipment such as “cable.”</span>
              </div>
            ) : null}
          </div>
        </div>

        {selected ? (
          <article className="exercise-guide-detail">
            <div className="exercise-guide-detail-heading">
              <div>
                <span>{selected.category}</span>
                <h3>{selected.name}</h3>
              </div>
              {activeKeys.has(selected.key) ? <b>In today&apos;s workout</b> : null}
            </div>

            <div className="exercise-guide-facts">
              <span><small>Primary areas</small><strong>{selected.muscles.join(" · ")}</strong></span>
              <span><small>Equipment</small><strong>{selected.equipment}</strong></span>
            </div>

            <section className="exercise-guide-section">
              <h4>How to perform it</h4>
              <ol>
                {selected.steps.map((step, index) => (
                  <li key={step}><b>{index + 1}</b><span>{step}</span></li>
                ))}
              </ol>
            </section>

            <div className="exercise-guide-columns">
              <section className="exercise-guide-section is-cues">
                <h4>Coach cues</h4>
                <ul>{selected.cues.map((cue) => <li key={cue}>{cue}</li>)}</ul>
              </section>
              <section className="exercise-guide-section is-mistakes">
                <h4>Avoid</h4>
                <ul>{selected.mistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul>
              </section>
            </div>

            <section className="exercise-guide-chatgpt">
              <span>OPTIONAL HANDOFF</span>
              <h4>Ask ChatGPT about {selected.name}</h4>
              <p>IronDesk prepares a technique-only prompt. No workout history, Garmin, or Health Connect data is included.</p>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Optional: Ask about stance, grip, a beginner variation…"
                rows={3}
              />
              <div>
                <button type="button" onClick={preparePrompt}>Copy prompt</button>
                <a
                  href={CHATGPT_EXERCISE_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={preparePrompt}
                >
                  Copy + open ChatGPT ↗
                </a>
              </div>
              {copyStatus ? <small role="status">{copyStatus}</small> : null}
            </section>

            <p className="exercise-guide-safety">
              Educational guidance only. Stop for sharp pain, numbness, dizziness, or symptoms that feel unsafe.
            </p>
          </article>
        ) : null}
      </div>
    </section>
  );
}

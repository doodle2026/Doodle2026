'use client';
// javascript: URLs are blocked by our CSP, so "back" is a real button.
export default function BackLink() {
  return (
    <button type="button" className="btn btn--ghost" onClick={() => (history.length > 1 ? history.back() : location.assign('/'))}>
      ← Gå tilbage
    </button>
  );
}

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordField({ label, value, onChange, placeholder, autoComplete = 'new-password', autoFocus = false }) {
  const [revealed, setRevealed] = useState(false);
  const inputId = useId();
  const action = revealed ? 'Hide' : 'Show';

  return (
    <div className="field-label">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-field">
        <input
          id={inputId}
          autoFocus={autoFocus}
          className="text-input"
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-visibility"
          onClick={() => setRevealed((visible) => !visible)}
          aria-label={`${action} ${label.toLowerCase()}`}
          aria-pressed={revealed}
          title={`${action} ${label.toLowerCase()}`}
        >
          {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
}

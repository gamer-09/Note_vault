import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PasswordField from './PasswordField';

afterEach(cleanup);

function ControlledPasswordField({ label = 'Passphrase' }) {
  const [value, setValue] = useState('');
  return <PasswordField label={label} value={value} onChange={setValue} placeholder="Type a passphrase" />;
}

describe('PasswordField visibility control', () => {
  it('reveals and re-masks the current value without changing it or submitting its form', () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(<form onSubmit={onSubmit}><ControlledPasswordField /></form>);
    const input = screen.getByLabelText('Passphrase');

    fireEvent.change(input, { target: { value: 'correct horse battery staple' } });
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveValue('correct horse battery staple');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Hide passphrase' }));
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('correct horse battery staple');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps confirmation-field visibility independent', () => {
    render(<><ControlledPasswordField /><ControlledPasswordField label="Confirm passphrase" /></>);
    const passphrase = screen.getByLabelText('Passphrase');
    const confirmation = screen.getByLabelText('Confirm passphrase');

    fireEvent.click(screen.getByRole('button', { name: 'Show passphrase' }));
    expect(passphrase).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveAttribute('type', 'password');
  });
});

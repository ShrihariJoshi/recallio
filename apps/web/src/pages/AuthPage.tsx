import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";
import { loginSchema, registerSchema, type PublicUser } from "@recallio/contracts";
import { authApi } from "../api";

type Props = { onAuthenticated: (user: PublicUser) => void };

export function AuthPage({ onAuthenticated }: Props) {
  const [register, setRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const data = new FormData(event.currentTarget);
    const input = Object.fromEntries(data.entries());
    const parsed = (register ? registerSchema : loginSchema).safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your details and try again."); setBusy(false); return; }
    try {
      const response = register
        ? await authApi.register(parsed.data as { name: string; email: string; password: string })
        : await authApi.login(parsed.data as { email: string; password: string });
      onAuthenticated(response.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign you in."); }
    finally { setBusy(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story" aria-label="About Recallio">
      <div className="story-top"><a className="brand" href="/"><span className="brand-mark">r</span><span>recallio</span></a><span className="story-note">A quieter way to learn</span></div>
      <div className="story-content">
        <div className="eyebrow"><Sparkles size={14} strokeWidth={1.7} /> LEARN WITH INTENTION</div>
        <h1>Make what<br />you learn <em>last.</em></h1>
        <p>Small, focused review sessions. The right thing, at the right time.</p>
        <div className="story-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <div className="orbit-core"><span>R</span><small>recall</small></div>
          <span className="orbit-dot dot-one" /><span className="orbit-dot dot-two" /><span className="orbit-dot dot-three" />
        </div>
      </div>
      <div className="story-bottom"><span>Thoughtful repetition. Lasting knowledge.</span><span>01 — 03</span></div>
    </section>

    <section className="auth-panel">
      <div className="auth-panel-top"><span className="mobile-brand"><span className="brand-mark">r</span> recallio</span><span className="secure-label">YOUR LEARNING, YOUR PACE</span></div>
      <div className="auth-form-wrap">
        <div className="form-heading"><span className="form-kicker">{register ? "A GOOD PLACE TO BEGIN" : "WELCOME BACK"}</span><h2>{register ? "Create your account" : "Pick up where you left off."}</h2><p>{register ? "Your learning space is ready when you are." : "Sign in to continue your learning."}</p></div>
        <form className="auth-form" onSubmit={submit} noValidate>
          {register && <label className="field"><span>Your name</span><input name="name" autoComplete="name" placeholder="How should we address you?" required /></label>}
          <label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>
          <label className="field"><span>Password</span><span className="password-wrap"><input name="password" type={showPassword ? "text" : "password"} autoComplete={register ? "new-password" : "current-password"} placeholder={register ? "At least 12 characters" : "Enter your password"} required /><button className="password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="submit-button" type="submit" disabled={busy}>{busy ? "One moment…" : register ? "Create account" : "Sign in"}<ArrowRight size={17} /></button>
        </form>
        <p className="switch-auth">{register ? "Already have an account?" : "New to Recallio?"}<button type="button" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Sign in" : "Create an account"}</button></p>
        <div className="privacy-note"><span className="privacy-dot" />Your progress stays yours. Always.</div>
      </div>
      <div className="auth-footer"><span>© Recallio</span><span>LEARN. RECALL. REPEAT.</span></div>
    </section>
  </main>;
}

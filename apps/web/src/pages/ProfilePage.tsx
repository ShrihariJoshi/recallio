import { useState, type FormEvent } from "react";
import { ArrowLeft, Check, DoorOpen, Save, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { profileUpdateSchema, type PublicUser } from "@recallio/contracts";
import { authApi } from "../api";
import { WorkspaceLayout } from "../components/WorkspaceLayout";

export function ProfilePage({ user, onUserUpdated, onLogout }: { user: PublicUser; onUserUpdated: (user: PublicUser) => void; onLogout: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function logout() {
    await authApi.logout().catch(() => undefined);
    onLogout();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaved(false);
    const parsed = profileUpdateSchema.safeParse({ name, email });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your profile details."); return; }
    setBusy(true);
    try {
      const result = await authApi.updateProfile(parsed.data);
      onUserUpdated(result.user);
      setName(result.user.name);
      setEmail(result.user.email);
      setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t save your profile."); }
    finally { setBusy(false); }
  }

  return <WorkspaceLayout user={user} title="Profile">
    <div className="profile-page">
      <Link className="back-link" to="/"><ArrowLeft size={15} />Your learning space</Link>
      <div className="profile-heading"><span className="profile-avatar-large">{user.name.charAt(0).toUpperCase()}</span><div><div className="date-label">ACCOUNT</div><h1>Your profile</h1><p>Update the details used for your Recallio account.</p></div></div>
      <div className="profile-layout">
        <section className="profile-panel">
          <div className="profile-panel-heading"><span><UserRound size={17} /></span><div><strong>Personal details</strong><small>Change your display name and sign-in email.</small></div></div>
          <form className="profile-form" onSubmit={(event) => void saveProfile(event)} noValidate>
            <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={80} required /></label>
            <label className="field"><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" maxLength={254} required /><small>Used for your Recallio account.</small></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            {saved && <div className="profile-saved" role="status"><Check size={15} />Profile saved.</div>}
            <button className="small-primary profile-save" type="submit" disabled={busy}><Save size={15} />{busy ? "Saving…" : "Save changes"}</button>
          </form>
          <button className="profile-signout" type="button" onClick={() => void logout()}><DoorOpen size={15} />Sign out</button>
        </section>
      </div>
    </div>
  </WorkspaceLayout>;
}

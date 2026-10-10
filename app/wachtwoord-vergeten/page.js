import Logo from "@/components/ui/Logo";

// Er is (bewust) geen e-maildienst gekoppeld, dus ook geen zelfbediening via een
// resetcode per mail. Een beheerder geeft een tijdelijk wachtwoord; bij de
// eerstvolgende login stelt de gebruiker zelf een nieuw wachtwoord in.
export const metadata = { title: "Wachtwoord vergeten | VeriPasso" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-6 text-center text-lg font-semibold text-slate-900">Wachtwoord vergeten?</h1>
        <div className="mt-4 space-y-3 text-sm text-slate-600">
          <p>
            Vraag de beheerder van je organisatie om een tijdelijk wachtwoord. Beheerders doen dit via
            <span className="font-medium text-slate-800"> Organisatie → Medewerkers → Wachtwoord resetten</span>.
          </p>
          <p>
            Ben je zelf de beheerder van je organisatie? Neem dan contact op met je partner of met
            VeriPasso-support.
          </p>
          <p>Bij je eerstvolgende login met het tijdelijke wachtwoord stel je direct een nieuw, eigen wachtwoord in.</p>
        </div>
        <a
          href="/login"
          className="mt-6 block w-full rounded-lg bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Terug naar inloggen
        </a>
      </div>
    </main>
  );
}

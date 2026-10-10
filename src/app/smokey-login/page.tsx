import { SmokeyBackground, LoginForm } from "@/components/ui/login-form";

export const metadata = {
  title: "Smokey Login — WebGL Shader",
  description:
    "Glassmorphism login over an interactive WebGL smoke shader, in LUXONN gold.",
};

export default function SmokeyLoginPage() {
  return (
    <main className="relative w-screen h-screen bg-[#050505] overflow-hidden">
      <SmokeyBackground className="absolute inset-0" />
      <div className="relative z-10 flex items-center justify-center w-full h-full p-4">
        <LoginForm />
      </div>
    </main>
  );
}

import type { Metadata } from 'next';
import { SimonAssistantChat } from '@/components/simon/SimonAssistantChat';

export const metadata: Metadata = {
  title: 'Simon Concierge — LUXONN',
  description:
    'A full-page concierge session with Simon: tokens stream as he thinks, and every search he runs is shown as it happens.',
};

export default function SimonChatPage() {
  return (
    <main
      data-simon-full-page
      className="h-dvh overflow-hidden bg-[#050505]"
    >
      <SimonAssistantChat />
    </main>
  );
}

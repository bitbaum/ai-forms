import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ai-forms — fill a form from a sentence, then keep talking to it',
  description:
    'Live example of ai-forms: prose fills the form, and follow-up instructions patch it instead of wiping it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/lib/providers';
import { Footer, Navbar, TxToasts } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'DonasiTransparan - Platform Donasi Berbasis Blockchain',
  description: 'Donasi dengan jejak dana end-to-end: escrow smart contract, pencairan per milestone, persetujuan multi-pihak, dan bukti IPFS.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <Providers>
          <Navbar />
          <main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-8">{children}</main>
          <Footer />
          <TxToasts />
        </Providers>
      </body>
    </html>
  );
}

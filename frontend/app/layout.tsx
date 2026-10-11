import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'FileFlow — Processing Pipeline', description: 'Upload, process, and manage files asynchronously.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

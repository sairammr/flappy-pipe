import type { Metadata, Viewport } from "next";

import { Providers } from "./providers";
import { Shell } from "./shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flappy Pipe",
  description: "Flappy Bird where the bird is a live on-chain price. Bet testnet dollars on where it flies, settled on NEAR.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#14120e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}

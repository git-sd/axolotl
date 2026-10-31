import { Nunito } from "next/font/google";

// Rounded terminals that still hold up at heavy display weights.
export const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
});

import { HeroSection } from "@/components/HeroSection";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Navbar />
      <main>
        <HeroSection />
        {/* Additional sections will be added here */}
      </main>
      <Footer />
    </div>
  );
}

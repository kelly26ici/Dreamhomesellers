import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeaturedProperties from "@/components/FeaturedProperties";
import About from "@/components/About";
import PropertyShowcase from "@/components/PropertyShowcase";
import Services from "@/components/Services";
import Testimonials from "@/components/Testimonials";
import VideoSection from "@/components/VideoSection";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <FeaturedProperties />
        <About />
        <PropertyShowcase />
        <Services />
        <Testimonials />
        <VideoSection />
        <Contact />
      </main>
      <Footer />
    </>
  );
}

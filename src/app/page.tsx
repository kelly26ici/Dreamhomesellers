import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import FeaturedProperties from "@/components/FeaturedProperties";
import About from "@/components/About";
import PropertyShowcase from "@/components/PropertyShowcase";
import Services from "@/components/Services";
import TestimonialsV2 from "@/components/testimonials-v2/TestimonialsV2";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";
import SimonLauncher from "@/components/SimonLauncher";

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
        <TestimonialsV2 />
        <Contact />
      </main>
      <SimonLauncher />
      <Footer />
    </>
  );
}

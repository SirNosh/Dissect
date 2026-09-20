import { useRef, useState, useCallback, type MouseEvent } from "react";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Code2,
  Command,
  Database,
  GitCompareArrows,
  Menu,
  Network,
  ScanLine,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { CursorIcon } from "~/components/agent-icons";
import "~/dissect.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const screenshots = [
  {
    src: "/dissect-workspace.png",
    label: "Architecture",
    alt: "Dissect workspace with an agent conversation and the BillSplitter architecture map",
    width: 1915,
    height: 1069,
  },
  {
    src: "/dissect-code.png",
    label: "Code explanations",
    alt: "Dissect explains bill sanitization beside annotated Python source code",
    width: 709,
    height: 1070,
  },
  {
    src: "/dissect-changes.png",
    label: "Change analysis",
    alt: "Dissect change analysis showing modified files, architecture impact, and key concepts",
    width: 706,
    height: 1064,
  },
];
const features = [
  {
    title: "See the whole system.",
    subtitle: "From repository to mental model.",
    description:
      "Turn a maze of files into an interactive architecture map. Follow the connections, open a folder, and see how the pieces fit.",
    icon: Network,
    detail: "Architecture → folder → file",
  },
  {
    title: "Go beneath the surface.",
    subtitle: "Every block has a purpose.",
    description:
      "Explore semantic annotations next to your source. Ask a focused question, or tell Dissect which concepts you already understand.",
    icon: ScanLine,
    detail: "Real source. Clear explanations.",
  },
  {
    title: "Understand the delta.",
    subtitle: "Keep up with what just changed.",
    description:
      "When your agent finishes, Dissect Diff explains the actual Git changes: what moved, what connects, and why it matters.",
    icon: GitCompareArrows,
    detail: "One explicit click. The exact diff.",
  },
];
const questions = [
  {
    quote: "Where does a request go after it hits the API?",
    answer:
      "Trace the route through authentication and into the data layer. Open each connection to see the source behind it.",
    label: "Find your bearings",
  },
  {
    quote: "What did my agent actually change?",
    answer:
      "Compare repository snapshots and explore explanations attached to changed files and semantic blocks.",
    label: "Follow the change",
  },
  {
    quote: "I know the syntax. Why is it built this way?",
    answer:
      "Mark the concepts you know, then ask a folder-specific question grounded in the code in front of you.",
    label: "Go a level deeper",
  },
];

function Brand() {
  return (
    <a href="#" className="ds-brand" aria-label="Dissect home">
      <img src="/dissect.svg" width="29" height="29" alt="" />
      dissect<span className="ds-brand-dot">.</span>
    </a>
  );
}

function ProductScreenshots() {
  const [selected, setSelected] = useState(0);
  const screenshot = screenshots[selected];
  const selectScreenshot = useCallback(function selectScreenshot(
    event: MouseEvent<HTMLButtonElement>,
  ) {
    setSelected(Number(event.currentTarget.dataset.index));
  }, []);

  return (
    <div className="ds-demo-wrap" id="demo">
      <div className="ds-demo-caption">
        <span>
          <span className="ds-live-dot" /> A LITTLE CLARITY, IN ACTION
        </span>
        <span>
          The real Dissect workspace <ArrowDownRight size={14} />
        </span>
      </div>
      <div className="ds-screenshot-tabs" role="group" aria-label="Product screenshots">
        {screenshots.map((item, index) => (
          <button
            type="button"
            key={item.src}
            data-index={index}
            onClick={selectScreenshot}
            aria-pressed={selected === index}
          >
            {item.label}
          </button>
        ))}
      </div>
      <a
        className="ds-window ds-screenshot-frame"
        href={screenshot.src}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${screenshot.label.toLowerCase()} screenshot at full size`}
      >
        <img
          src={screenshot.src}
          alt={screenshot.alt}
          width={screenshot.width}
          height={screenshot.height}
          fetchPriority="high"
        />
      </a>
      <div className="ds-demo-under">
        <span>
          <Command size={13} /> Your agent. Your workspace. A clearer picture.
        </span>
        <span>
          Open screenshot at full size <ArrowUpRight size={13} />
        </span>
      </div>
    </div>
  );
}

function FeatureArt({ index }: { index: number }) {
  const screenshot = screenshots[index];
  return (
    <div className="ds-feature-art">
      <img
        src={screenshot.src}
        alt={screenshot.alt}
        width={screenshot.width}
        height={screenshot.height}
        loading="lazy"
      />
    </div>
  );
}

export function DissectLanding() {
  const root = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState(0);
  const [question, setQuestion] = useState(0);

  const closeMenu = useCallback(function closeMenu() {
    setMenuOpen(false);
  }, []);
  const toggleMenu = useCallback(
    function toggleMenu() {
      setMenuOpen(!menuOpen);
    },
    [menuOpen],
  );
  const selectFeature = useCallback(function selectFeature(event: MouseEvent<HTMLButtonElement>) {
    setActiveFeature(Number(event.currentTarget.dataset.index));
  }, []);
  const previousQuestion = useCallback(
    function previousQuestion() {
      setQuestion((question + questions.length - 1) % questions.length);
    },
    [question],
  );
  const nextQuestion = useCallback(
    function nextQuestion() {
      setQuestion((question + 1) % questions.length);
    },
    [question],
  );

  useGSAP(
    () => {
      root.current?.setAttribute("data-ready", "true");
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference) and (min-width: 800px)", () => {
        gsap.from(".ds-hero-copy > *", {
          y: 22,
          opacity: 0,
          duration: 0.85,
          stagger: 0.12,
          ease: "power3.out",
        });
        gsap.fromTo(
          ".ds-window",
          { scale: 0.8 },
          {
            scale: 1,
            ease: "none",
            scrollTrigger: { trigger: ".ds-demo-wrap", start: "top 90%", end: "top 25%", scrub: 1 },
          },
        );
        gsap.to(".ds-window", {
          opacity: 0.2,
          ease: "none",
          scrollTrigger: {
            trigger: ".ds-demo-wrap",
            start: "bottom 25%",
            end: "bottom top",
            scrub: true,
          },
        });
        gsap.utils.toArray<HTMLElement>(".ds-principle").forEach((panel, index) => {
          if (index === 2) return;
          ScrollTrigger.create({
            trigger: panel,
            start: "top 112px",
            endTrigger: ".ds-principles",
            end: "bottom 390px",
            pin: true,
            pinSpacing: false,
          });
          gsap.to(panel, {
            scale: 0.96,
            scrollTrigger: { trigger: panel, start: "top 112px", end: "+=350", scrub: true },
          });
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <main ref={root} className="dissect-site overflow-x-hidden w-full max-w-full">
      <nav className="ds-nav ds-container" aria-label="Main navigation">
        <Brand />
        <div className={`ds-nav-links ${menuOpen ? "is-open" : ""}`}>
          <a href="#product" onClick={closeMenu}>
            The product
          </a>
          <a href="#how-it-works" onClick={closeMenu}>
            How it works
          </a>
          <a href="#learning" onClick={closeMenu}>
            Learning journey
          </a>
        </div>
        <a className="ds-nav-cta" href="#demo">
          See the product <ArrowUpRight size={15} />
        </a>
        <button
          type="button"
          className="ds-menu"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </nav>
      <section className="ds-hero ds-container">
        <div className="ds-hero-copy">
          <div className="ds-eyebrow">
            <span className="ds-short-line" /> KEEP THE AGENT. OWN THE UNDERSTANDING.
          </div>
          <h1>
            Your agent writes code.
            <br />
            <span>Make it make sense.</span>
          </h1>
          <p>
            Move fast without losing the plot. Dissect turns the code your
            <br className="ds-desktop-break" /> agent leaves behind into a system you actually
            understand.
          </p>
          <div className="ds-hero-actions">
            <a href="#demo" className="ds-button ds-button-primary">
              Explore Dissect <ArrowUpRight size={17} />
            </a>
            <a href="#how-it-works" className="ds-button ds-button-outline">
              See how it works <ArrowDown size={15} />
            </a>
          </div>
        </div>
        <ProductScreenshots />
      </section>
      <section className="ds-agents ds-container" aria-label="Supported coding agents">
        <p>A NEW PERSPECTIVE. SAME CODING AGENT.</p>
        <div>
          <span>
            <ScanLine /> <b>Claude Code</b>
          </span>
          <span>
            <Command /> <b>Codex</b>
          </span>
          <span>
            <CursorIcon /> <b>Cursor</b>
          </span>
          <span>
            <Code2 /> <b>OpenCode</b>
          </span>
          <span>
            <Terminal /> <b>GitHub Copilot</b>
          </span>
          <span className="ds-agent-pi">
            π <b>Pi</b>
          </span>
          <span className="ds-and-more">Your workflow, intact.</span>
        </div>
      </section>
      <section id="product" className="ds-product ds-container ds-section">
        <div className="ds-section-heading">
          <div>
            <p className="ds-kicker">FROM “IT WORKS” TO “I GET IT”</p>
            <h2>
              Less black box.
              <br />
              More <span className="ds-serif">big picture.</span>
            </h2>
          </div>
          <p>
            Writing code got faster.
            <br />
            Understanding it should keep up.
            <br />
            Meet the missing layer in your workflow.
          </p>
        </div>
        <div className="ds-features">
          {features.map((feature, index) => (
            <button
              type="button"
              key={feature.title}
              className={`ds-feature ${activeFeature === index ? "is-active" : ""}`}
              data-index={index}
              onClick={selectFeature}
              aria-expanded={activeFeature === index}
            >
              <div className="ds-feature-top">
                <feature.icon size={25} strokeWidth={1.4} />
                <ArrowUpRight size={19} />
              </div>
              <FeatureArt index={index} />
              <div className="ds-feature-copy">
                <h3>{feature.title}</h3>
                <p>{activeFeature === index ? feature.description : feature.subtitle}</p>
                <span>{feature.detail}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="ds-how ds-section" id="how-it-works">
        <div className="ds-container">
          <div className="ds-section-heading">
            <div>
              <p className="ds-kicker">STAY IN YOUR FLOW</p>
              <h2>
                One workspace.
                <br />A little more <span className="ds-serif">perspective.</span>
              </h2>
            </div>
            <ArrowDownRight className="ds-large-arrow" size={70} strokeWidth={1} />
          </div>
          <div className="ds-principles">
            <article className="ds-principle">
              <div className="ds-step-icon">
                <Terminal size={25} />
              </div>
              <div>
                <h3>Build with your agent.</h3>
                <p>
                  Claude Code, Codex, Cursor, OpenCode, Copilot, Pi. Keep your conversation,
                  terminals, and worktrees. Work the way you already do.
                </p>
              </div>
              <span className="ds-step-note">
                Familiar tools.
                <br />
                Same momentum.
              </span>
            </article>
            <article className="ds-principle">
              <div className="ds-step-icon">
                <ScanLine size={25} />
              </div>
              <div>
                <h3>Dissect when you’re ready.</h3>
                <p>
                  One click reads the actual repository. Explore an architecture map, drill into
                  folders, and find explanations next to the source.
                </p>
              </div>
              <span className="ds-step-note">
                You choose
                <br />
                when to look closer.
              </span>
            </article>
            <article className="ds-principle">
              <div className="ds-step-icon">
                <GitCompareArrows size={25} />
              </div>
              <div>
                <h3>Make sense of what’s next.</h3>
                <p>
                  Your agent makes a change. Dissect Diff explains the exact delta from your last
                  analysis. Keep your mental model up to date.
                </p>
              </div>
              <span className="ds-step-note">
                Understand the change.
                <br />
                Keep moving.
              </span>
            </article>
          </div>
        </div>
      </section>
      <section id="learning" className="ds-learning ds-section" aria-labelledby="learning-title">
        <div className="ds-container">
          <div className="ds-learning-heading">
            <p className="ds-kicker">YOUR LEARNING, REMEMBERED</p>
            <h2 id="learning-title">
              Dissect evolves
              <br />
              <span className="ds-serif">with you.</span>
            </h2>
            <p>
              Tell Dissect what you know and where you need more depth. Every future explanation
              starts closer to your level.
            </p>
          </div>
          <div className="ds-learning-grid">
            <div className="ds-learning-path" aria-label="How Dissect adapts to your learning">
              <div>
                <span>01</span>
                <strong>Explore a concept</strong>
                <small>In a file, folder, or change</small>
              </div>
              <div>
                <span>02</span>
                <strong>Set the depth</strong>
                <small>“I know this” or “Explain more”</small>
              </div>
              <div>
                <span>03</span>
                <strong>Move forward</strong>
                <small>Less repetition, more useful context</small>
              </div>
            </div>
            <div className="ds-learning-copy">
              <div className="ds-spacetime-label">
                <Database size={18} strokeWidth={1.6} /> Powered by SpacetimeDB
              </div>
              <h3>Your learning journey becomes context.</h3>
              <p>
                We use SpacetimeDB to remember the concepts you explicitly mark and the parts of a
                project you understand. Dissect uses that context to shape future code, folder, and
                diff explanations around what is new to you.
              </p>
              <p className="ds-learning-note">
                No passive behavior tracking. No invented mastery score. You decide what Dissect
                remembers.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section id="philosophy" className="ds-philosophy ds-container ds-section">
        <p className="ds-kicker">BUILT FOR THE PERSON BEHIND THE PROMPT</p>
        <h2>
          Fast is good.
          <br />
          Fast, with understanding,
          <br />
          is <span className="ds-serif">better.</span>
        </h2>
        <div className="ds-philosophy-bottom">
          <p>
            You should be able to explain the software you ship.
            <br />
            Dissect helps you build that understanding, one
            <br className="ds-desktop-break" /> connection, one concept, one change at a time.
          </p>
          <div className="ds-trust">
            <ShieldCheck size={25} strokeWidth={1.3} />
            <div>
              <strong>Your code is the source of truth.</strong>
              <span>
                Analysis runs when you ask. Selected source goes to your configured model. Agent
                transcripts stay out.
              </span>
            </div>
          </div>
        </div>
      </section>
      <section className="ds-questions ds-container" aria-label="Questions you can explore">
        <div className="ds-question-label">
          <span className="ds-live-dot" /> {questions[question].label}
          <span>THE QUESTIONS WORTH ASKING</span>
        </div>
        <div className="ds-question-content" aria-live="polite">
          <blockquote>“{questions[question].quote}”</blockquote>
          <p>{questions[question].answer}</p>
        </div>
        <div className="ds-question-controls">
          <span>
            {String(question + 1).padStart(2, "0")}{" "}
            <i>/ {String(questions.length).padStart(2, "0")}</i>
          </span>
          <div>
            <button type="button" aria-label="Previous question" onClick={previousQuestion}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" aria-label="Next question" onClick={nextQuestion}>
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      </section>
      <section className="ds-final ds-container">
        <div className="ds-final-mark">
          <img src="/dissect.svg" width="48" height="48" alt="" />
        </div>
        <p className="ds-kicker">THE CODE IS YOURS. THE UNDERSTANDING SHOULD BE, TOO.</p>
        <h2>
          Don’t just ship it.
          <br />
          <span className="ds-serif">Get it.</span>
        </h2>
        <a href="#demo" className="ds-button ds-button-primary">
          Take a closer look <ArrowUpRight size={17} />
        </a>
        <p className="ds-final-note">Explore real screenshots from the Dissect workspace.</p>
      </section>
      <footer className="ds-footer ds-container">
        <div>
          <Brand />
          <p>The comprehension layer for your coding agent.</p>
        </div>
        <div className="ds-footer-links">
          <a href="#product">
            Product <ArrowUpRight size={12} />
          </a>
          <a href="#how-it-works">
            How it works <ArrowUpRight size={12} />
          </a>
          <a href="https://github.com/getpaseo/paseo" target="_blank" rel="noreferrer">
            Built on Paseo <ArrowUpRight size={12} />
          </a>
        </div>
        <div className="ds-footer-bottom">
          <span>© {new Date().getFullYear()} Dissect</span>
          <span>Built on the open-source Paseo project · Apache 2.0</span>
          <span>Stay curious.</span>
        </div>
      </footer>
    </main>
  );
}

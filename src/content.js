// Everything the site says. The build renders it twice from here: the monitor's screen, and /llms.txt (also the
// page's hidden agent text). A tile either links straight out, or opens a page of its own: a list of items, each a
// link out (what it was built to solve, then what it is) or an email address. Every `id` is also the site's anchor for
// that thing: mt-gocode.github.io/#pacemaker opens the screen on it.
export const NAME = 'Minh Trinh'

const QOL = 'https://github.com/MT-GoCode/minh-qol-utilities/tree/main'

export const TILES = [
  { kind: 'link', id: 'linkedin', label: 'LinkedIn', icon: 'linkedin', href: 'https://www.linkedin.com/in/minh-trinh-26744a1b0/' },
  { kind: 'link', id: 'github', label: 'GitHub', icon: 'github', href: 'https://github.com/MT-GoCode' },
  {
    kind: 'page',
    label: 'Side projects',
    icon: 'terminal',
    id: 'projects',
    items: [
      {
        kind: 'link',
        id: 'irreproachable',
        title: 'irreproachable',
        href: `${QOL}/irreproachable`,
        solve: "Coding agents' /goal systems are rigid to a fault. In Claude Code, cheap Haiku judges \"done\", so it passes half-done work, invents requirements, pushes impossible goals, nags agents awaiting long builds and misses rabbit holes.",
        what: "The agent judges itself. It clears goals when done and quits impossible ones with a reason. Nudges come only when it's fully idle, not waiting on a long-running command or subagent. A 30-minute steer catches rabbit holes. It's silent during permission prompts and spent usage, sends on resets, and lets the agent edit its goal and mute nudges when reasonable.",
      },
      {
        kind: 'link',
        id: 'pacemaker',
        title: 'pacemaker',
        href: `${QOL}/pacemaker`,
        solve: "Coding agents have time blindness. Hand one a run that takes an hour, a day, or a subagent, and it goes dead on you. The run hangs or fails early, the signs are there, and nobody looks until the time and money are gone.",
        what: "pacemaker gives the agent a sense of time. It reports on the run while it runs, so the agent notices when a job is taking longer than it should or has gone quiet, investigates, and aborts early. Half-hour builds, multi-day trainings, subagents and CI get shepherded to the end, every time.",
      },
      {
        kind: 'link',
        id: 'elucidate-8b',
        title: 'elucidate-8B',
        href: 'https://huggingface.co/freshminttt/elucidate',
        solve: "Readers can hear AI writing. They tune it out the moment they notice, and Pangram and GPTZero flag it.",
        what: "elucidate-8B writes like a person, and it fooled Pangram and GPTZero 100% of the time. I SFT'd Meta's Llama 3.1 8B on a dataset I curated myself, trained it with DDP on rented B300s, and paid for it out of my own pocket. Hand it an outline and it writes finished prose, running locally on a Mac, in one of five engaging registers: systems primer, build-along, first principles, steelman and unit economics.",
      },
    ],
  },
  {
    kind: 'page',
    label: 'Contact',
    icon: 'person-circle',
    id: 'contact',
    items: [{ kind: 'email', address: 'minhtr@g.ucla.edu' }],
  },
]

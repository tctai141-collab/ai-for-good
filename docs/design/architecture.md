# Sprint Buddy — System Architecture

## Core Components

### 1. AI Advisor Engine (RAG-based)
- Knowledge base ingestion (Mårten's documents → embeddings)
- Retrieval-augmented generation for contextual responses
- Extensible: adding a new advisor = new document set, not new code

### 2. Daily Check-in System
- 2–3 questions per day, timed delivery
- Pattern detection: tracks themes across check-ins over time
- Reflection triggers (e.g. "You've mentioned X three times this week")

### 3. Founder Profiling (stretch)
- 6 Types of Working Genius assessment
- Strengths/blind spots mapping
- Team role recommendations

### 4. Organizer Signal (stretch)
- Weekly attention-need flags
- Human-in-the-loop: buddy surfaces patterns, team makes calls
- Clear privacy boundaries communicated to users

## Key Design Decisions

- **Privacy-first:** Must feel safe, not monitored. If users perform instead of reflect, the system fails.
- **Voice + text:** Text is baseline, voice is differentiator
- **Coach-in-pocket tone:** Not corporate, not clinical — a real human who's been there
- **Pluggable advisors:** Mårten is coach 1. Coach 2 should be a doc upload away.
- **Mascot is core:** Sprint Buddy's mascot is part of the product identity, not a decorative extra.

## Hackathon Product Plan

This is the current target scope and priority order.

### Founder Experience

- **Mascot:** Build and keep the buddy mascot as a visible, emotionally supportive companion.
- **Chatbots:** Provide multiple distilled founder/operator advisors.
  - First advisor: distilled Mårten Mickos / MySQL CEO perspective.
  - Second advisor: another distilled founder perspective.
- **Check-ins:** A daily conversational check-in that asks for:
  - one scale-based answer about how the day is going.
  - one or two short text answers about what feels difficult.
  - a visible, satisfying completion moment after submitting.
  - a visible privacy notice explaining what is private and what may be shared for the current answer.
- **Adaptive questions:** Start with human-authored check-in questions. Over time, adapt questions using memory from daily conversations and check-ins.
- **Reflection view:** Help founders understand where they are right now.
  - 6-pillar reflection test.
  - 6 Types of Working Genius assessment.
  - summary of current strengths, blind spots, and likely best team role.

### Organizer Experience

- **Organizer dashboard:** Show insights about founders and teams without exposing raw private answers.
- **Organizer Buddy:** AI-assisted organizer view is second priority after the founder experience.
  - Helps organizers interpret aggregate signals.
  - Suggests who may need a human check-in.
  - Keeps human-in-the-loop decision making.

## Tech Stack Considerations

Suggested initial stack (subject to team decision):
- Frontend: mobile-first web app
- Backend: API server + vector database for RAG
- LLM: API access to a capable model
- Embeddings: text-embedding model for document retrieval

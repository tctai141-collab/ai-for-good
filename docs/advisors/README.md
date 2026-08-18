# Advisor knowledge — where it actually lives

This directory used to hold nine files named after advisor corpora
(`marten_quora_answers.txt`, `paul_graham_sources.md`, and so on). Every one of
them contained a single line: *"Mock advisor content … placeholder text for the
public repository."* Nothing in `src/` ever read them. The README told the next
person to "replace with real processed advisor material before deploying",
which — in a public repo, for copyrighted writing by real people — was advice
that should not have been followed.

They have been deleted, because a filename that looks like knowledge but holds
none is worse than no file at all. Naming a knowledge file does not make the
model retrieve it.

## Where the knowledge is now

**The Mårten Mickos persona** carries a distilled knowledge pack inline, in
`src/lib/personas.ts`. It is paraphrased frameworks, positions and short
attributed quotes — safe to publish — plus a short list of episodes that
genuinely happened, with an explicit instruction not to invent beyond them.
There is no retrieval step, and deliberately so: a vector store is
infrastructure this app should not carry for a cohort of about twenty.

**The full corpus** — his Quora answers, LinkedIn articles, social posts, a
2011 Stanford talk, and the "Working with Mårten" document — is copyrighted and
personal, and stays out of this repository entirely. It lives in the private
`Marten AI` workspace and is uploaded only to the private Claude Project, where
native retrieval can use it at full fidelity.

**The other personas** are archetypes, not people. The contrarian advisor was
once written as a named real person who had never been asked; it now carries
the posture without the identity. Mårten is named because he is on the
operating team and consented.

## If you are adding a new advisor

Two questions first. Is this a real person who has agreed to be impersonated to
students? And can the knowledge be published — meaning paraphrased, attributed,
and not a copy of someone's copyrighted work? If either answer is no, build an
archetype instead.

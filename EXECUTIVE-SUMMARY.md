# Live Phone Translation — What We Tested and What We Chose

*Plain-English summary. Technical details live in `PROVIDER-COMPARISON.md` and
`docs/polly-tier-test-results.md`.*

## What this is

A phone line where two people who speak different languages can talk to each
other. A Spanish speaker calls in, an English speaker answers, and each person
hears the other's words translated and spoken aloud in their own language by a
computer voice — live, during the call.

## What we tested

We made real test calls using every computer voice available on our phone
platform — three from Amazon and two from ElevenLabs — and compared how they
sound, how fast the conversation flows, and what they cost.

| Voice option | How it sounds | Conversation speed | Cost |
|---|---|---|---|
| **ElevenLabs Flash** ✅ *our choice* | **Like an actual human talking** | Same as the others | Same as the others |
| ElevenLabs Turbo | Also human-like, but being discontinued | Same | Same |
| Amazon Polly Generative | Amazon's best — still robotic, and the flow of speech seems off | Same | Same |
| Amazon Polly Neural | Robotic, flow seems off | Same | Same |
| Amazon Polly Standard | Very robotic, flow seems off | Same | Same |

## The three takeaways

**1. Every voice costs exactly the same, so we picked the best-sounding one.**
The phone platform charges one flat rate (7¢ per minute) no matter which voice
we use. Upgrading from the most robotic voice to the most human one was free —
so the choice was easy: ElevenLabs, the voice that sounds like a real person.

**2. The voice doesn't change how fast the conversation feels.**
We measured over a hundred conversation turns across all five voices. The pace
of a translated call is set by people — how long they talk and think — not by
the computer voice. Every voice came out the same in real conversation. (The
translation step itself is effectively instant: about 0.15 seconds.)

**3. The whole thing costs about 10¢ per minute of conversation.**
That's everything: the phone call itself, the speech recognition, the
translation, and the human-sounding voice.

## Bottom line

The system works today: a Spanish speaker and an English speaker can hold a
natural phone conversation, each hearing a human-sounding voice in their own
language, for about 10¢ a minute. We chose the ElevenLabs "Flash" voice because
it sounds like a person rather than a robot — and it costs nothing extra.

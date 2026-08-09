// Authored-sortie comms lines (phase 11 INC-7) — numeric lineId -> subtitle
// text, RENDER-SIDE ONLY (ids-not-strings doctrine, CAMPAIGN-DESIGN.md §0/§3:
// the Script's comms ring stores ids; the HUD looks text up here; phase 13
// bakes VO onto the same ids). The authored loader merges this table over
// missions.js COMMS_LINES the way main.js merges engine.js OP_LINES.
//
// Allocation (COMMS_LINES x0..x4 convention widened to 10-wide blocks):
//   300-309 N01 · 310-319 N02 · 320-329 V01 · 330-339 V02 ·
//   340-349 M01 · 350-359 M02
//   within a block: x0 title, x1-x3 briefing card (x1 doubles as the
//   ON_START establishing call — beat 2 fires the fiction inside 10 s),
//   x4 ingress flavor, x5 THE TURN callout, x6 victory, x7 defeat/timeout,
//   x8-x9 set-piece extras.
//   380-391 ace set-piece lines (4 per ace: taunt / smoking / escaped /
//   killed): 380-383 JACKAL · 384-387 BOREAS · 388-391 SHRIKE.
// TYPHOON (the MARIANAS finale) is deliberately absent — his lines ship
// with the finale sortie, not the opening six.

export const SORTIE_LINES = {
  // ---- N01 FIRST BLOOD (nellis-01) ----
  300: "FIRST BLOOD",
  301: "OVERLORD: Raptor 1-1, a resupply column is rolling for the pass with a gun truck riding shotgun. Kill every vehicle before it reaches the tunnel mouth.",
  302: "Intel counts four movers and one ZSU-23 escort on the basin road, pushing northwest under the afternoon haze.",
  303: "This is your first pull of the war. Make it clean, make it loud — the line moves tonight.",
  304: "OVERLORD: Ingress is clean. The column is between the wash and the road cut — respect the escort's tracers.",
  305: "OVERLORD: The two-ship you've been tracking northeast just turned in — they're committing on the basin. They came to answer for the convoy. Fight's on, Raptor.",
  306: "OVERLORD: Splash two! Column dead, sky clean. That's first blood, Raptor 1-1 — RTB when ready.",
  307: "OVERLORD: The column made the tunnel and we lost the light. Come home — we pay for this one on the map.",
  308: "RAPTOR 1-1: Tally column — five vehicles crawling the road. Rolling in.",
  309: "OVERLORD: Second echelon confirmed MOVING — your targets are driving. Lead them or lose them.",

  // ---- N02 JACKAL'S HOUR (nellis-02) ----
  310: "JACKAL'S HOUR",
  311: "OVERLORD: Raptor 1-1, the south range SAM site is radiating again — one dish, two rails. Put it down for good.",
  312: "Be advised: an aggressor lead, callsign JACKAL, is sweeping the high range north of the site. He is gun-hungry and he is patient.",
  313: "Kill the site, keep your energy, and don't give him the phone booth he wants. The range goes dark at your call.",
  314: "OVERLORD: They'll launch the second you cross six klicks. Break late, break hard, and the rails come up empty.",
  315: "OVERLORD: Site's down and blind — and JACKAL just turned in off the sweep. He knows exactly where you are. Stay fast until we call you off.",
  316: "OVERLORD: Site's dark and JACKAL is off the board. The range belongs to us tonight — magnum work, Raptor 1-1. RTB.",
  317: "OVERLORD: Out of time — the site is still radiating and JACKAL owns the range tonight. RTB.",
  318: "RAPTOR 1-1: Contact — dish and launchers on the flat. Engaging.",
  319: "OVERLORD: RWR shows the dish sweeping your line. You're in his living room now.",

  // ---- V01 HOLD THE NARROWS (valdez-01) ----
  320: "HOLD THE NARROWS",
  321: "OVERLORD: Raptor 1-1, three friendly hulls are holding station in the narrows — two tankers and the destroyer ANCHORAGE. Raiders inbound off the gulf. Nothing touches those ships.",
  322: "Intel tracked a strike package staging west down the Sound: sea-skimmers, low and slow until they're not.",
  323: "The escort can take a hit. The tankers cannot. You are the reason this convoy exists tomorrow.",
  324: "OVERLORD: Convoy is at your nose, holding station between the arms. First raiders will come from the west — low.",
  325: "OVERLORD: SECOND STREAM inbound — three more. They were holding at the glacier line, waiting for the escort to blink. This is the real push.",
  326: "OVERLORD: Lane is clear — every raider is in the water and every hull is still floating. The Sound owes you, Raptor 1-1.",
  327: "OVERLORD: We lost a hull in the narrows. The convoy scatters and this front bleeds. RTB.",
  328: "RAPTOR 1-1: Overhead the convoy. ANCHORAGE is flashing a lamp at me — tell them to keep it in the water.",
  329: "OVERLORD: Raid confirmed — sea-skimmers hugging the deck, first pair burning for the escort.",

  // ---- V02 RACE THE SOUND (valdez-02) ----
  330: "RACE THE SOUND",
  331: "OVERLORD: Raptor 1-1, drone raid is through the glacier passes, tracking for your field. You are the only thing between them and the fence. Burn.",
  332: "Three airframes in the first stream, more suspected behind the weather. If one crosses the fence, the pad closes and the Sound goes quiet.",
  333: "Winds calm, ceiling unlimited. This is a footrace, and you were built for it.",
  334: "OVERLORD: Stream one is descending the valley line. Intercept geometry is yours — nose on, gate open.",
  335: "OVERLORD: SECOND STREAM out of the northwest — and a shadow riding above it. That's BORA— correction, BOREAS. High cover. Watch the sun.",
  336: "OVERLORD: Picture clean — both streams down, fence never touched. The field stays open because of you, Raptor 1-1.",
  337: "OVERLORD: They're over the fence — the field is taking hits. Get down and RTB. This one hurts.",
  338: "RAPTOR 1-1: Judy. I'm on the leaders.",
  339: "OVERLORD: Sixty seconds and they're inside the last valley. Whatever you're doing — do it faster.",

  // ---- M01 REEF LINE (marianas-01) ----
  340: "REEF LINE",
  341: "OVERLORD: Raptor 1-1, the resupply pair is anchored inside the reef line — one freighter, one destroyer screen. Raid warning is red. Keep them afloat.",
  342: "The freighter carries the whole forward airstrip in her holds: fuel, ordnance, the works. She IS the campaign.",
  343: "Raiders will come off the water in pairs and threes. The reef gives you clean lines — use them.",
  344: "OVERLORD: Anchorage is quiet, sea state calm. First bogeys expected off the eastern approach, on the deck.",
  345: "OVERLORD: NEW RAID, bullseye north — three sea-skimmers in trail, going for the freighter this time. They watched the first pair die for the escort.",
  346: "OVERLORD: Raid's in the water, both hulls swinging at anchor like nothing happened. Textbook fleet defense, Raptor 1-1.",
  347: "OVERLORD: Hull loss inside the reef. The strip goes hungry and the front knows it by morning. RTB.",
  348: "RAPTOR 1-1: Overhead the anchorage. Decks are manned, guns cold — they're trusting me with this.",
  349: "OVERLORD: Contacts confirmed east — two raiders on the deck, running the reef line straight at the screen.",

  // ---- M02 THE HORNET'S NEST (marianas-02) ----
  350: "THE HORNET'S NEST",
  351: "OVERLORD: Raptor 1-1, the enemy carrier group is on station west of the chain — the flattop and her destroyer screen. Sink the group. All of it.",
  352: "That deck has been cycling strikes against the islands for a week. She will not die in one pass — nobody sinks a carrier in one pass. Make your runs, hit the pad at Andersen, and come back until she stops answering.",
  353: "Guard-channel chatter puts a name over that deck: SHRIKE. Ambusher. He comes out of the haze when you're heaviest. Finish the ships, then watch the north.",
  354: "OVERLORD: Push point ahead. The group's screen is radiating search only — they don't know what's coming.",
  355: "OVERLORD: The flattop's going down — and SHRIKE's flight is committing out of the north. He was always going to pick this moment. Fight's on.",
  356: "OVERLORD: Group sunk and the ambush is beaten — SHRIKE is out of the fight. That's a day they'll write down, Raptor 1-1.",
  357: "OVERLORD: Out of time — the group is still making way and the strait stays theirs. RTB.",
  358: "RAPTOR 1-1: Tally the group — wake lines on the flattop and her escort. Beginning my run.",
  359: "OVERLORD: Screen is awake — expect company before the last hull goes under.",

  // ---- ace set-pieces: taunt / smoking / escaped / killed ----
  380: "JACKAL (guard): 'New tail number on the range. They keep sending me strangers to bury.'",
  381: "JACKAL (guard): 'A scratch. You bought a scratch with everything you had.'",
  382: "OVERLORD: JACKAL is running for the fence, smoking but alive. Remember the paint — you'll see it again.",
  383: "OVERLORD: SPLASH JACKAL! The aggressors just lost their loudest voice. Outstanding.",
  384: "BOREAS (guard): 'The mountain wind knocks down everything that climbs. Climb for me, little Raptor.'",
  385: "BOREAS (guard): 'Cold air in the cockpit. No matter. The wind doesn't bleed.'",
  386: "OVERLORD: BOREAS is running north over the glacier, trailing smoke. He'll ice that wound and come back meaner.",
  387: "OVERLORD: SPLASH BOREAS! The high cover is gone — the north wind just died.",
  388: "SHRIKE (guard): 'You sank my ships with your back to the sea. I am the sea.'",
  389: "SHRIKE (guard): 'Smoke. Mine or yours? ...Mine. Enjoy it while it lasts.'",
  390: "OVERLORD: SHRIKE is dragging smoke into the haze, out toward the deck edge of the map. He'll be back — they always come back.",
  391: "OVERLORD: SPLASH SHRIKE! Straight into the water off the reef. The haze is just haze again.",
};

// alias for the authored loader (campaign/authored.js reads L.LINES first)
export const LINES = SORTIE_LINES;

export default SORTIE_LINES;

// Authored-sortie comms lines (phase 11 INC-7) — numeric lineId -> subtitle
// text, RENDER-SIDE ONLY (ids-not-strings doctrine, CAMPAIGN-DESIGN.md §0/§3:
// the Script's comms ring stores ids; the HUD looks text up here; phase 13
// bakes VO onto the same ids). The authored loader merges this table over
// missions.js COMMS_LINES the way main.js merges engine.js OP_LINES.
//
// Allocation (COMMS_LINES x0..x4 convention widened to 10-wide blocks):
//   300-309 N01 · 310-319 N02 · 320-329 V01 · 330-339 V02 ·
//   340-349 M01 · 350-359 M02 · 360-369 N03 · 370-379 N04 ·
//   400-409 V03 · 410-419 V04 · 420-429 M03 · 430-439 M04 ·
//   450-459 N05 · 460-469 N06 · 470-479 V05 · 480-489 V06 ·
//   490-499 M05 · 500-509 M06
//   530-539 N07 · 540-549 N08 · 550-559 V07 · 560-569 V08 ·
//   570-579 M07 · 580-589 M08
//   within a block: x0 title, x1-x3 briefing card (x1 doubles as the
//   ON_START establishing call — beat 2 fires the fiction inside 10 s),
//   x4 ingress flavor, x5 THE TURN callout, x6 victory, x7 defeat/timeout,
//   x8-x9 set-piece extras.
//   380-391 ace set-piece lines (4 per ace: taunt / smoking / escaped /
//   killed): 380-383 JACKAL · 384-387 BOREAS · 388-391 SHRIKE.
//   392-399 D-073 panel-carry patch lines (wave-2 announcement backstops,
//   offense clock warnings, defense timeout-victory flavor) · 440-449
//   INC-8 batch-1 extras (M01 timeout flavor, JACKAL return taunt, per-
//   sortie overflow where a 10-wide block ran dry; 449 = N06's own
//   smoking taunt, the batch-2-panel rider on the id reserved for it) ·
//   510-529 INC-8 batch-2 extras (510-519: N06 ledger-agnostic JACKAL
//   taunt, clock warnings and backstops where a 10-wide block ran dry;
//   520-529: the batch-2 panel-must overflow — 520 N05 wave-1 clock,
//   521 V06 trough-2 clock) · 590-599 INC-8 batch-3 extras (un-gated
//   backstops + clocks where a 10-wide block ran dry; 598 = N07 PACKAGE
//   LEAD join call, 599 = V07 mid-belt clock — the D-078 chair's id
//   assignments, applied as batch-4 riders).
// INC-8 BATCH 4 — THE FINALE (sorties 25-30):
//   600-609 N09 · 610-619 N10 · 620-629 V09 · 630-639 V10 ·
//   640-649 M09 · 650-659 M10 ·
//   660-663 VIPER ace set (taunt / smoking / escaped / killed) ·
//   664-668 TYPHOON ace set (taunt / smoking / bingo / escaped / killed —
//   the bingo hook is new: one 9X takes an ace 120 -> 30, SKIPPING the
//   smoking band, so the chase call is the beat that actually renders) ·
//   669-689 batch-4 extras (un-gated backstops, clocks, finale ace lines) ·
//   690-715 LABEL BANK (objective labelId -> HUD row text, the D-078
//   enabler; shared across sorties by design — one id, one utterance,
//   VO-ready) ·
//   716-717 finale-panel riders (716 = N10 JACKAL bingo beat; 717 = N09
//   VIPER bingo beat).
// TYPHOON ships HERE (M10) and nowhere else — the reserve held for 24
// sorties and the finale spends it.

export const SORTIE_LINES = {
  // ---- N01 FIRST BLOOD (nellis-01) ----
  300: "FIRST BLOOD",
  301: "OVERLORD: Raptor 1-1, a resupply column is rolling for the pass with a gun truck riding shotgun. Kill the four movers before they reach the tunnel mouth.",
  302: "Intel counts four movers and one ZSU-23 escort on the basin road, pushing northwest under the afternoon haze.",
  303: "This is your first trip of the war. Guns for the column — and save two rails for whatever comes to answer. The line moves tonight.",
  304: "OVERLORD: Ingress is clean. The column is between the wash and the road cut — respect the escort's tracers.",
  305: "OVERLORD: The two-ship you've been tracking northeast just turned in — they're committing on the basin. They came to answer for the convoy. Fight's on, Raptor.",
  306: "OVERLORD: Splash two! Column dead, sky clean. That's first blood, Raptor 1-1 — RTB when ready.",
  307: "OVERLORD: The window is closed and the line doesn't move tonight. Come home, Raptor — we pay for this one on the map.",
  308: "RAPTOR 1-1: Tally column — four movers and the gun truck crawling the road. Rolling in.",
  309: "OVERLORD: The column just cleared the wash and it is not stopping. Driving targets, Raptor — lead them or lose them.",

  // ---- N02 JACKAL'S HOUR (nellis-02) ----
  310: "JACKAL'S HOUR",
  311: "OVERLORD: Raptor 1-1, the south range SAM site is radiating again — one dish, two rails. Put it down for good.",
  312: "Be advised: an aggressor lead, callsign JACKAL, is sweeping the high range north of the site. He is gun-hungry and he is patient.",
  313: "Kill the site, keep your energy, and don't give him the phone booth he wants. The range goes dark at your call.",
  314: "OVERLORD: They'll launch the second you cross six klicks. Break late, break hard, and the rails come up empty.",
  315: "OVERLORD: Site's down and blind — and JACKAL just turned in off the sweep. He knows exactly where you are. Take him off the board — you're cleared unrestricted.",
  316: "OVERLORD: Site's dark and JACKAL is off the board. The range belongs to us tonight — surgical work, Raptor 1-1. RTB.",
  317: "OVERLORD: Out of time — the site is still radiating and JACKAL owns the range tonight. RTB.",
  318: "RAPTOR 1-1: Contact — dish and launchers on the flat. Engaging.",
  319: "OVERLORD: RWR shows the dish sweeping your line. You're in the site's living room now.",

  // ---- V01 HOLD THE NARROWS (valdez-01) ----
  320: "HOLD THE NARROWS",
  321: "OVERLORD: Raptor 1-1, three friendly hulls are holding station in the narrows — two tankers and the destroyer ANCHORAGE. Raiders inbound off the gulf. Nothing touches those ships.",
  322: "Intel tracked a strike package staging west down the Sound: sea-skimmers, low and slow until they're not.",
  323: "The escort can take a hit. The tankers cannot. You are the reason this convoy exists tomorrow.",
  324: "OVERLORD: Convoy is at your nose, holding station between the arms. First raiders will come from the west — low.",
  325: "OVERLORD: SECOND STREAM inbound — three more. They were holding at the glacier line, waiting for the escort to blink. This is the real push.",
  326: "OVERLORD: Lane is clear — every raider is in the water and every hull is still floating. The Sound owes you, Raptor 1-1.",
  327: "OVERLORD: We lost a hull in the narrows. The convoy scatters and this front bleeds. RTB.",
  328: "RAPTOR 1-1: Overhead the convoy. ANCHORAGE is flashing a lamp at me — tell her to save the light for the raiders.",
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
  343: "Raiders will come off open water on a fresh axis every wave — east first, then wherever you are not looking. The reef gives you clean lines; your neck gives you the rest.",
  344: "OVERLORD: The reef line is quiet, sea state calm. First bogeys expected off the eastern approach, on the deck.",
  345: "OVERLORD: Second wave committing, bullseye north — three sea-skimmers in trail, and this time they want the freighter. The first pair spent themselves on the screen; these will not.",
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
  355: "OVERLORD: The flattop's going down — and the haze to the north just answered. SHRIKE's flight, three ships, committing on your position. He picked this exact moment. Fight's on.",
  356: "OVERLORD: Group sunk and the ambush is beaten — SHRIKE is out of the fight. That's a day they'll write down, Raptor 1-1.",
  357: "OVERLORD: The group is still making way and the light is gone. The strait stays theirs tonight. RTB.",
  358: "RAPTOR 1-1: Tally the group — wake lines on the flattop and her escort. Beginning my run.",
  359: "OVERLORD: Screen is awake — expect company before the last hull goes under.",

  // ---- N03 LIFELINE (nellis-03) ----
  360: "LIFELINE",
  361: "OVERLORD: Raptor 1-1, four friendly movers are driving the south basin road with the whole forward line's ammunition aboard. Raiders are airborne. The column arrives intact — that is the entire mission.",
  362: "REPULSE flight got a look before they went bingo: one scout raider already committed out of the northeast, and a second package forming up behind the western ridge.",
  363: "The column can lose one truck and still feed the line. Lose two and tonight's push dies on this road.",
  364: "OVERLORD: Column is rolling, steady eight meters a second. You'll make the overhead with time to set up — use it.",
  365: "OVERLORD: Scout's down — and the second package just turned inbound off the western ridge. Three raiders, on the deck, burning for the column. This is the real attempt.",
  366: "OVERLORD: Raid's finished and the column is still rolling. The line eats tonight because of you, Raptor 1-1.",
  367: "OVERLORD: Two movers are burning on the basin road. The column is combat-ineffective — the push is off. RTB.",
  368: "RAPTOR 1-1: Overhead the column. Movers and dust — I'll take the watch from here.",
  369: "OVERLORD: Confirming three contacts WEST, on the deck, in trail — they want the column. Whatever you're doing, finish it.",

  // ---- N04 JACKAL'S DEBT (nellis-04) ----
  370: "JACKAL'S DEBT",
  371: "OVERLORD: Raptor 1-1, a two-ship is strutting a racetrack over the north range — and the flight lead is squawking JACKAL's old callsign. Clear the range. All of it.",
  372: "Intel can't confirm the man. The students hold the racetrack; the paint holds back, high and east, the way he always did.",
  373: "If it's really him, he owes this range a debt from last time. Collect it — and keep your energy when the paint turns in.",
  374: "OVERLORD: Gate's ahead. The two-ship hasn't broken pattern — they don't know what's coming. The paint will.",
  375: "OVERLORD: Both students are in the dirt — and there he is. The paint just turned in off the high east, committing straight at you. It's him, Raptor. It was always him.",
  376: "OVERLORD: The range is clear and the paint is off the board — for good or for now. Debt collected, Raptor 1-1. RTB.",
  377: "OVERLORD: We're out of night and the racetrack is still theirs. He'll dine on this for a year. RTB.",
  378: "RAPTOR 1-1: Through the gate. Tally the two-ship on the racetrack — going up the hill after them.",
  379: "OVERLORD: Five minutes, Raptor. Nobody leaves this range owning it but you.",

  // ---- ace set-pieces: taunt / smoking / escaped / killed ----
  380: "JACKAL (guard): 'New tail number on the range. They keep sending me strangers to bury.'",
  381: "JACKAL (guard): 'A scratch. You bought a scratch with everything you had.'",
  382: "OVERLORD: JACKAL is running for the fence, smoking but alive. Remember the paint — you'll see it again.",
  383: "OVERLORD: SPLASH JACKAL! The range just changed owners. Outstanding.",
  384: "BOREAS (guard): 'The mountain wind knocks down everything that climbs. Climb for me, little Raptor.'",
  385: "BOREAS (guard): 'Cold air in the cockpit. No matter. The wind doesn't bleed.'",
  386: "OVERLORD: BOREAS is running north over the glacier, trailing smoke. He'll ice that wound and come back meaner.",
  387: "OVERLORD: SPLASH BOREAS! The high cover is gone — the north wind just died.",
  388: "SHRIKE (guard): 'You watched the water the whole way in. The haze was watching you back.'",
  389: "SHRIKE (guard): 'Smoke. Mine or yours? ...Mine. Enjoy it while it lasts.'",
  390: "OVERLORD: SHRIKE is dragging smoke into the haze, out toward the deck edge of the map. He'll be back — they always come back.",
  391: "OVERLORD: SPLASH SHRIKE! Straight into the water off the reef. The haze is just haze again.",

  // ---- 392-399: D-073 panel-carry patch lines (INC-8 Part A) ----
  // 392 M02 SHRIKE-flight tracking warning (t=290 — the early-committed
  //     descent is never unannounced even if obj 2 is stalled)
  392: "OVERLORD: That haze contact north of the group is descending toward the station — three airframes, tight formation. Keep one eye up, Raptor.",
  // 393/394 wave-2 announcement backstops (un-gated ON_TIME — wave-1
  //     egressers can freeze obj 2 and mute the climax; the panel's words)
  393: "OVERLORD: New contacts NORTH, on the deck, in trail — they're going for the freighter.",
  394: "OVERLORD: Second stream confirmed at the glacier line — three in trail, tracking the tankers.",
  // 395 V02 stream-two clock (state-agnostic wording — must not count down
  //     a dead raid, the 339 lesson)
  395: "OVERLORD: Ninety seconds, give or take — anything still airborne out of the northwest is at the fence after that. Finish it.",
  // 396-398 offense-timeout clock warnings (t=1200 = five minutes out)
  396: "OVERLORD: Five minutes of light left, Raptor. Whatever is still alive down there, kill it now.",
  397: "OVERLORD: Five minutes, Raptor 1-1. If the site is still up — or JACKAL is — the range stays his.",
  398: "OVERLORD: Five minutes of window left. Finish the group, settle the haze, and come home.",
  // 399 V01 defense-timeout VICTORY flavor (t=1500 — the raid ran out of
  //     ordnance before the convoy ran out of luck; was radio-silent)
  399: "OVERLORD: That's the window — the raid is spent and every hull is still swinging at anchor. The narrows held, Raptor 1-1. RTB.",

  // ---- V03 BACKDRAFT (valdez-03) ----
  400: "BACKDRAFT",
  401: "OVERLORD: Raptor 1-1, the shore depot is stacking ordnance for a push down the Sound. Get in there and burn it. In and out — the field needs you back on the pad, not sightseeing.",
  402: "Two ammunition movers on the flats, under the east shore battery's umbrella — one gun truck and a live rail with its dish still turning. Respect both.",
  403: "Intel doesn't like tonight: too much radio traffic behind the glacier line. If something launches while you're deep, it's a footrace home.",
  404: "OVERLORD: Clean picture ahead. The battery's dish is sweeping lazy — they haven't seen you. Keep it that way until the first truck burns.",
  405: "OVERLORD: Depot's burning — and there's the other shoe: raid warning RED, three airframes out of the northwest, tracking for YOUR field. You're on the wrong side of the Sound, Raptor. BURN.",
  406: "OVERLORD: Splash three — fence never touched, depot's a crater. That's an out-and-back they'll teach, Raptor 1-1.",
  407: "OVERLORD: We're out of window. The depot job stands unfinished and the Sound knows we blinked. RTB.",
  408: "RAPTOR 1-1: Run-in point. Tally the depot — two movers fat on the flats. Rolling in.",
  409: "OVERLORD: Be advised — the northwest contacts are past the glacier line and descending. The fence clock is real, whatever else you're doing.",

  // ---- V04 SOULS ABOARD (valdez-04) ----
  410: "SOULS ABOARD",
  411: "OVERLORD: Raptor 1-1, three transports are climbing out of the lower Sound with wounded and ground crews aboard — every soul this front can't replace. Hostile air is moving to cut the corridor. Nothing touches them.",
  412: "The transports hold the racetrack over the water until you clear the gate at the head of the Sound. Two pickets are already probing it; a full sweep is forming up behind the weather.",
  413: "Check your fire around the big wings, Raptor. Tonight you are the difference between a corridor and a graveyard.",
  414: "OVERLORD: Transports at your nose, lights out, holding pattern steady. Pickets are northeast, working down toward the gate.",
  415: "OVERLORD: Pickets are in the water — and the sweep just broke out of the weather. Three fighters, northwest, running the glacier line for the gate. This is the real cut, Raptor.",
  416: "OVERLORD: Sweep's finished. Corridor is clear — the transports are climbing through the gate with every soul still aboard. Some nights the job is holy, Raptor 1-1.",
  417: "OVERLORD: Hostile through the gate — the corridor is compromised and the transports are turning back into the weather. We just lost tomorrow. RTB.",
  418: "OVERLORD: CEASE FIRE — a transport is going down. Souls aboard, Raptor. There is no version of tonight where that was worth it. RTB.",
  419: "RAPTOR 1-1: Joined on the transports. Three big wings, steady in the pattern — I have the corridor watch.",

  // ---- M03 THE LAST LIGHTER (marianas-03) ----
  420: "THE LAST LIGHTER",
  421: "OVERLORD: Raptor 1-1, Tinian is trying to leave. One lighter is loading the strip's ordnance at the anchorage and a truck column is crawling the pier road to feed her. Nothing gets off that island.",
  422: "The lighter is the prize — eighty rounds of hull or one good missile. The column is four movers, slow and heavy, worth a line in the ledger. The strip's gun and rail are still live between them.",
  423: "Guard channel says their alert pair is holding north over the water. Sink the lighter and they will stop holding.",
  424: "OVERLORD: Golden light, glass sea. The lighter's deck crane is swinging — she's mid-load and fat. Run-in point ahead.",
  425: "OVERLORD: Lighter's going down at the pier — and the alert pair just committed out of the north, descending on the anchorage. They kept them back for exactly this. Fight's on.",
  426: "OVERLORD: Alert pair splashed and the lighter's on the bottom. Tinian keeps its ordnance forever. Beautiful work, Raptor 1-1.",
  427: "OVERLORD: The light's gone and the evacuation runs tonight. Whatever's left on that pier sails tomorrow. RTB.",
  428: "RAPTOR 1-1: Run-in point. Tally the lighter at the pier and movers on the road above it. Beginning my run.",
  429: "OVERLORD: The alert pair north of the island is moving — descending toward the anchorage. Whatever the state of your run, they're coming to it.",

  // ---- M04 THE COURIER (marianas-04) ----
  430: "THE COURIER",
  431: "OVERLORD: Raptor 1-1, a courier transport lifted out of the northern chain carrying the theater's command staff and every codebook they own. It is running south for open water. It does not arrive.",
  432: "He's flying the deck weeds with a two-ship of pickets sweeping ahead and, intel suspects, close escort welded to his wing. Kill the screen, find the courier, end the war a year early.",
  433: "If he crosses the southern channel he's under their fleet umbrella and gone. There is no tomorrow on this one, Raptor. There is only today.",
  434: "OVERLORD: Datum ahead. The picket two-ship is weaving the middle passage — they're sanitizing his road. Start with them.",
  435: "OVERLORD: Screen's down — and the picture just resolved behind it: one heavy transport on the deck, running the island line south, two fighters welded to his wings. That's your courier, Raptor. RUN HIM DOWN.",
  436: "OVERLORD: Courier's in the water. Every plan they had just died with the mail. That's a career sortie, Raptor 1-1 — RTB.",
  437: "OVERLORD: He's through the channel — under the fleet umbrella and gone. The staff, the books, all of it. This war just got a year longer. RTB.",
  438: "RAPTOR 1-1: On the datum. Picture building — two weavers ahead, something bigger in the returns behind them.",
  439: "OVERLORD: Plot puts the courier ninety seconds from the channel mouth. If you're going to make a move, it's now.",

  // ---- 440-449: INC-8 batch-1 extras ----
  // 440 M01 defense-timeout VICTORY flavor (the 399 pattern, reef fiction)
  440: "OVERLORD: Raid window's closed — both hulls afloat and the strip eats tomorrow. That's the whole job, Raptor 1-1. RTB.",
  // 441 N04 JACKAL return taunt (guard, t=45 — the 380 pattern; reads true
  //     whether N02 ended in his escape or his death, per the 372 hedge)
  441: "JACKAL (guard): 'I know that tail number. I kept the smoke as a souvenir — come collect yours.'",
  // 442 N03 defense-timeout VICTORY flavor
  442: "OVERLORD: Window's closed — the raiders are spent and the column is still rolling. Textbook escort, Raptor 1-1. RTB.",
  // 443 V04 sweep backstop (t=355, un-gated — gate ring ≈ 413-419 s)
  443: "OVERLORD: The northwest group is inside the last fjord — a minute from the gate. Anything still airborne up there is your problem RIGHT NOW.",
  // 444 V03 fence-denial defeat
  444: "OVERLORD: They're over the fence — the pad is taking hits and the Sound goes quiet tonight. This one's on the ledger. RTB.",
  // 445 M03 optional column ledger
  445: "OVERLORD: That's the column — the pier road is a scrapyard. The lighter would have loaded nothing but smoke anyway.",
  // 446 M04 defense-timeout VICTORY flavor (courier already dead)
  446: "OVERLORD: Window's closed with the courier's wreck still smoking on the plot. The stragglers can tell the story. RTB, Raptor 1-1.",
  // 447 M03 / 448 V03 offense clock warnings (t=1200, the 396-398 pattern)
  447: "OVERLORD: Five minutes of light left. If anything of Tinian's is still floating, flying, or rolling — fix that.",
  448: "OVERLORD: Five minutes of window, Raptor. The ledger doesn't care how close you got.",
  // 449 N06's OWN smoking taunt (batch-2 panel rider on the id reserved for
  // it): reusing 381's "everything you had" was untrue in an OPTIONAL duel —
  // the resource taunt is ammo-agnostic (time spent on him is spent either
  // way) and points back at the column, which is the mission.
  449: "JACKAL (guard): 'Everything you spend on me, the column keeps. Smoke's a fair trade — I'd take it again.'",

  // ---- N05 THE AIR BRIDGE (nellis-05) ----
  450: "THE AIR BRIDGE",
  // 451 batch-2 panel rider: the "All of it." briefing closer had calcified
  // (351/371/451) — trimmed.
  451: "OVERLORD: Raptor 1-1, heavy transports are coming down the northern corridor — a battalion on the pallets, bound for the desert LZ. The airlift dies tonight.",
  452: "Two waves confirmed: the lead pair is already through the fence line, and the second is forming up east with company — intel reads a pair of fast movers sweeping ahead of it.",
  453: "Heavies are slow, fat, and helpless. The guns riding shotgun are none of those things. Kill the freight, respect the escort, and nothing lands.",
  454: "OVERLORD: Vector gate ahead. Wave one is northeast, letting down into the corridor — big, slow returns. You'll see their landing lights before they see anything.",
  455: "OVERLORD: Wave one is burning on the desert — and wave two just answered: two more heavies out of the east, and this time their GUNS came ahead of the freight. Fast pair, committing. Fight's on, Raptor.",
  // 456/457 batch-2 panel riders: 456's middle clause now carries the clean
  // wheels-down rhyme; 457 fires while the tripping heavy is still visibly
  // FLYING (zone denial trips at the ring, not the dirt) — "flaring" fixes it.
  456: "OVERLORD: Splash the airlift — every airframe killed still flying, not one wheel down, not one pallet on the dirt. The LZ stays empty tonight. Superb work, Raptor 1-1.",
  457: "OVERLORD: They're flaring over the LZ — wheels down in moments, pallets on the dirt inside the minute. The range just grew a garrison. RTB, Raptor. This one stings.",
  458: "RAPTOR 1-1: Through the gate. Picture's building — heavy returns letting down the corridor, more traffic east.",
  459: "OVERLORD: The fast pair east is inbound your area — ahead of their freight, hunting. Whatever the state of wave one, keep your head up.",

  // ---- N06 THE COUNTERPUSH (nellis-06) ----
  460: "THE COUNTERPUSH",
  461: "OVERLORD: Raptor 1-1, the counterattack is rolling — four loaded movers driving for the eastern pass behind dug-in gun cover. If that column makes the tunnel, next month happens on their terms. Kill the iron.",
  462: "Two ZSU-23s are holding the road bends ahead of the column — crack the shell before you touch the freight. And be advised: a fighter wearing JACKAL's paint is holding high northwest, flying cover for the push.",
  463: "Intel won't say whether it's the man or someone who inherited the airplane. It doesn't matter. The column is the mission — the paint is a debt, and debts are optional.",
  464: "OVERLORD: Column's on the move, steady eight meters a second, guns forward. Noon sun, no shadows to hide in — theirs or yours.",
  465: "OVERLORD: Both guns are dead on the road — and the paint just turned in off the high northwest. He's coming for you, Raptor, and the column keeps rolling while he does. Finish the iron under the hammer.",
  // 466 batch-2 panel rider: pays off the won-under-the-hammer structure in
  // the past tense, ace-agnostic (true whether JACKAL is overhead, run off,
  // or dead — the cover ASSIGNMENT is the fact, not his current state).
  466: "OVERLORD: The counterpush is burning end to end. They gave that column the best cover they had left and it bought them nothing — nothing reaches the tunnel, nothing reaches the pass. The month is ours, Raptor 1-1.",
  // 467 panel MUST-2: "out of light" contradicted todH 12 / 464's noon
  // sun, and the lead mover is ~12.0 of 16.7 km at t=1500 — a ridge from
  // the tunnel, not inside the approach.
  467: "OVERLORD: The lead mover is a ridge from the tunnel and the clock is spent. The counterattack lands on schedule. Come home, Raptor — we'll pay for this on the map.",
  468: "RAPTOR 1-1: Through the gate. Tally the column — four movers in file, two guns forward on the bends. Rolling in on the guns first.",
  469: "OVERLORD: The paint is descending toward the column corridor — high, fast, deliberate. He was always going to come down. Watch the sun.",

  // ---- V05 STILL WATER (valdez-05) ----
  470: "STILL WATER",
  471: "OVERLORD: Raptor 1-1, two hulls at anchor in the lower Sound — a destroyer and the freighter she shepherds. Decks dark, guns cold, radio silent. Put them on the bottom before the light changes.",
  472: "It's 2124 local and the sun won't finish setting — glass sea, gold water, no wind. Intel has their night patrol somewhere over the gulf, due back on an unknown clock.",
  // 473 batch-2 panel rider: the pair's one rail-economy clause lands here.
  473: "Nothing at that anchorage can touch you. Enjoy that while it's true — and spend like it isn't: guns for the hulls, rails for whoever comes home. The moment the first hull settles, the quiet is over.",
  474: "OVERLORD: Sound is dead calm. Your bow wave will be the loudest thing on the water tonight. Run-in point ahead.",
  475: "OVERLORD: Both hulls are going down — and there's the answer: the night patrol, two fast contacts, coming back down the gulf straight at the anchorage. The quiet's over, Raptor. Fight's on.",
  476: "OVERLORD: Patrol splashed, hulls on the bottom, and the water's already going still again. Some sorties are paintings, Raptor 1-1. RTB in the gold.",
  // 477 batch-2 panel rider: "the light's finally gone" broke the sortie's
  // own midnight-sun physics (472: the sun won't finish setting) — the
  // panel's replacement wording adopted.
  477: "OVERLORD: The gold's gone gray and the anchorage still floats. We don't get this window twice. RTB.",
  478: "RAPTOR 1-1: Run-in point. I have the hulls — two shadows on gold water, swinging at anchor. Beginning my attack. Quietly.",
  479: "OVERLORD: Contacts east over the gulf, descending — the night patrol is coming home early. Whatever's left on the water, finish it now.",

  // ---- V06 HOLD UNTIL RELIEVED (valdez-06) ----
  480: "HOLD UNTIL RELIEVED",
  481: "OVERLORD: Raptor 1-1, the relief squadron is ferrying in — wheels down in twenty-five minutes. Until then you are the Sound's entire air force. Take the station and hold it against everything they feed you.",
  482: "They know our window. Expect relays: probes first to make you spend, then shooters, then whatever they've been saving. Nobody's coming to help you — that's the entire point of you.",
  // 483 panel MUST-5: the old "like they have to last, because they do"
  // implied rails can't be replenished — the pad rearm is a legal move
  // (4 rails, match.js refill), and the 4-shooter coda needs it readable.
  483: "Fuel, missiles, patience. Spend all three like they have to last, because they do — and the pad behind you stays open. Trade the station for rails when you must, never for long. Hold until relieved.",
  484: "OVERLORD: Station's ahead. First relay is already inbound off the northeast — two contacts, loose, unhurried. They're here to take your measure.",
  485: "OVERLORD: Relay one is in the water — and relay two is committing EARLY, out of the northwest glacier line. Two contacts, and these are shooters, Raptor. The measuring is over.",
  // 486 panel MUST-1: the median win lands at 13-14.5 min against the
  // 25-minute relief clock 481/515/516 establish — the old "RELIEF FLIGHT
  // IS ON THE PAD" lied at the moment of triumph. Victory = the sky is
  // clean; the relief is still inbound.
  486: "OVERLORD: That's all three relays in the water and nothing left on their board. The sky you're handing the relief is clean, Raptor 1-1 — hold it until their wheels touch. Legendary.",
  487: "OVERLORD: We're out of window and the station is still contested. The relief lands into a hostile pattern. Get down, Raptor — this one's going to be a long debrief.",
  488: "RAPTOR 1-1: On station. Fuel's fat, rails are full, and the Sound is quiet. Start the clock.",
  489: "OVERLORD: Second relay destroyed — but the third is already moving: two contacts off their northern hold, descending. It's their best pair, Raptor. They're not stopping. THIS is the one.",

  // ---- M05 SCATTER (marianas-05) ----
  490: "SCATTER",
  491: "OVERLORD: Raptor 1-1, the Tinian site is the shield over the pier road — one dish, one rail, both live. Kill the site. And heads up: the moment you made landfall, the strip's ordnance convoy BOLTED. Four movers, two directions, driving right now.",
  492: "The site first — nothing near that strip is safe while the dish turns. Then run the movers down: west pair for the pier tunnels, north pair up the island line. Every truck that goes to ground tonight comes back as artillery next week.",
  493: "Their alert fighter is holding over the northern water. When the site goes dark he'll stop holding. Golden light, long shadows — use them.",
  494: "OVERLORD: The yard's already empty — dust trails on two roads, movers scattering. The site's dish is sweeping your line. You know the order, Raptor.",
  495: "OVERLORD: Site's dark — dish and rail both. Now it's a footrace with trucks: west pair's making for the tunnels, north pair for the tree line. And the alert fighter just committed off the northern water. Run them ALL down.",
  496: "OVERLORD: That's all four movers dead on the road and the site's a scrapheap. Tinian shipped nothing tonight but smoke. Beautiful chase, Raptor 1-1.",
  497: "OVERLORD: The light's gone and there's still iron moving on that island. Whatever went to ground tonight, we'll meet again — and it'll be shooting. RTB.",
  498: "RAPTOR 1-1: Run-in point. Tally the site on the rise — and I count four movers already rolling, two axes, getting smaller. Beginning my run.",
  // 499 batch-2 panel rider (seat-2 rewrite adopted in spirit): the
  // "Whatever the state of..." hedge had calcified (459/499), the line was a
  // near-rerun of M03's 429, and "fast, deliberate" collided with 469 inside
  // the same batch. Route-true replacement: at t=275 the sentinel IS off his
  // northern hold and descending (11 km ring entry ≈ 322 s).
  499: "OVERLORD: The alert fighter is off the northern water — descending on the strip with intent. He didn't wait for an invitation.",

  // ---- M06 FOUR CORNERS (marianas-06) ----
  500: "FOUR CORNERS",
  501: "OVERLORD: Raptor 1-1, their varsity is up — a four-ship, the theater's best, sweeping to take the strait picture back. They're converging on the mid-strait merge from four different axes. You're going to accept that merge. Alone.",
  502: "The pattern reads as a pincer and an anvil: two committing from the north corners first, two more holding wide south, waiting for you to be busy. No ace paint, no theatrics — just discipline. Respect it.",
  503: "Four shooters is the ceiling of what we'll ever ask you to stand in front of, Raptor. Today we're asking. High noon, clean sky, everything visible — including you.",
  504: "OVERLORD: Datum ahead. North pair is already inbound — one off each corner, converging like they've done it a hundred times. They have.",
  // 505 batch-2 panel rider: "tier above the last" was bandits.js vocabulary
  // in OVERLORD's mouth — the panel's replacement phrase adopted.
  505: "OVERLORD: North pair's in the water — and the south pair just came off their standoff. Two more, the better half of the four-ship, cutting north for the merge. The anvil's falling, Raptor. Stay fast, stay high, make them arrive one at a time.",
  506: "OVERLORD: FOUR FOR FOUR — their best flight is in the strait and the picture is ours from the reef to the rock. That merge belongs to the textbook now, Raptor 1-1. RTB.",
  507: "OVERLORD: Window's closed with their sweep still airborne. The strait picture goes to them tonight. Get down safe, Raptor — tomorrow we do arithmetic.",
  508: "RAPTOR 1-1: On the datum. Picture confirmed — four groups, four corners, all converging on me. ...Good.",
  // 509 batch-2 panel riders: the "ninety seconds" clock had calcified
  // (395/439/509) AND was wrong here (real anvil-to-merge ≈ 75 s) — trimmed;
  // and the old line asserted a live anvil to an anvil-first player — the
  // either/or keeps it true on every path.
  509: "OVERLORD: The south corners are empty — their second element is either inbound your merge or already in the water. Finish what's in front of you.",

  // ---- 510-519: INC-8 batch-2 extras ----
  // 510 N06 JACKAL guard taunt (t=45 — deliberately ledger-agnostic: works
  //     whether he's fresh, escaped-before, or the paint has a new pilot)
  510: "JACKAL (guard): 'This range buries every tail number they send it. Look down, Raptor — the iron rolls whether you live or not.'",
  // 511 N06 / 512 V05 / 516 V06 / 517 M05 / 518 M06 offense clock warnings
  //     (t=1200, the 396-398 pattern, per-sortie fiction)
  511: "OVERLORD: Five minutes, Raptor. The column doesn't care about fair — if it's rolling at the tunnel, they win.",
  512: "OVERLORD: Five minutes of gold left, Raptor 1-1. If anything still floats or flies out there, the painting isn't finished.",
  // 513 V06 relay-2 backstop (t=370, un-gated — ring ≈ 420-424 s). Batch-2
  // panel rider (seat-2 rewrite adopted in spirit): the "doesn't care"
  // closer had calcified (448/511/513) — replaced with an honest clock
  // (entry 420-424 s from t=370 = 50-54 s).
  513: "OVERLORD: Second relay is past the glacier line and descending on the station — two shooters, committed. Fifty seconds out, maybe less.",
  // 514 V06 coda descent backstop (t=640, un-gated — ring ≈ 680-694 s)
  514: "OVERLORD: Their northern hold is empty — the last pair is descending NOW. Best for last, Raptor. Hold what you're holding.",
  // 515 V06 relief clock (t=900)
  515: "OVERLORD: Relief flight checks in at ten minutes out. The station is still yours. Keep it that way and start thinking about what you'll tell them.",
  516: "OVERLORD: Five minutes to relief, Raptor. Don't make them fight for their own pattern.",
  517: "OVERLORD: Five minutes of light. Every mover still rolling at dark becomes next week's problem — end it tonight.",
  518: "OVERLORD: Five minutes, Raptor. Four-for-four or not at all — the strait doesn't grade on effort.",
  // 519 N05 wave-2 clock (t=385, un-gated — LZ ring ≈ 429-436 s)
  519: "OVERLORD: Wave two is through the last turn of the corridor — heavies letting down for the LZ. Anything still flying out there is on final in under a minute.",
  // 520 N05 wave-1 clock (panel MUST-3: the wave-1 wheels-down ring at
  //     297-306 s is a hard defeat via loseWhen and had ZERO clock-talk
  //     while wave 2 got 519; t=245, un-gated, state-agnostic)
  520: "OVERLORD: Anything still flying in wave one is on final — under a minute to wheels-down. Kill the freight FIRST, fight the guns after.",
  // 521 V06 trough-2 clock (panel MUST-4: ~190 s of quiet between the
  //     relay-1 kill and relay-2 entry — the >12 min exception was granted
  //     on the 'authored clock-talk in the troughs' premise; t=300,
  //     un-gated, keeps 513@370)
  521: "OVERLORD: Second relay is past the midline of the Sound, still committed. Four minutes of quiet left — spend it on fuel and angles.",

  // ---- N07 BIG FRIENDS (nellis-07) ----
  530: "BIG FRIENDS",
  531: "OVERLORD: Raptor 1-1, today the war goes north — three heavies are climbing out behind you, bound for the enemy marshalling yard. Everything they have left is coming up to stop it. You are the sweep.",
  532: "Two committed groups on the plot: a pair already driving in from the east, and a second element holding low in the south — their best, held back for the moment the bombers are heaviest.",
  // 533 batch-3 panel MUST-4: obj 6 is a need-1 one-shot loss and the 9X
  // seeker has no side filter — the check-fire warning is briefed up front.
  533: "Join at the rendezvous and take the fights out in front of the package. The heavies cannot run and they cannot shoot back — everything between them and the yard is yours to kill, and nothing wearing a friendly wing is on that list. Check fire around the package.",
  534: "OVERLORD: Package is off the deck behind you, three abreast, steady on the corridor. The east pair is inbound and the plot is honest — fly it right and you meet them well short of the freight.",
  535: "OVERLORD: East pair down — and the freight never even changed heading. Anything else that comes up today comes out of the south, and it comes for the yard. Stay between.",
  536: "OVERLORD: Sweep complete — every fighter they put up is down, and the heavies are making their runs with empty sky around them. That's the whole war turning over, Raptor 1-1. Take them home.",
  537: "OVERLORD: Hostile through the sweep — he's inside the bomber wheel and we are pulling the package out. The yard stands, the corridor closes, and we go back to defending. RTB, Raptor.",
  538: "RAPTOR 1-1: Joined on the package — three big wings holding formation like it's an airshow. Sweep's out in front. Let's go north.",
  539: "OVERLORD: CHECK FIRE, CHECK FIRE — a heavy is going down. There were people on that airplane, Raptor. There is no mission left in this. RTB.",

  // ---- N08 FUMES (nellis-08) ----
  540: "FUMES",
  541: "OVERLORD: Raptor 1-1, listen to how quiet it is. Their air arm is running dry — intel puts the last of their jet fuel in four bowsers at a dispersal yard in the north basin, pumping into bladders at first light. Burn it, and their war stops flying.",
  542: "The yard is naked — nothing that shoots within twelve klicks of it, nobody awake. What's left of their alert flight holds east over the far range, with just enough in the tanks to make one answer.",
  543: "Fly it gentle, hit it clean, and don't linger in the smoke. If the answer comes, it comes fast and it comes angry — they'll spend everything they have left to make it count.",
  544: "OVERLORD: First light on the basin floor. Nothing moving down there but your shadow. Yard's ahead — bowsers nose to tail at the bladders, dead asleep.",
  // 545 batch-3 panel MUST-3: on slower-than-median runs the pair is
  // already overhead or half-dead at the turn — state/count-agnostic form.
  545: "OVERLORD: The fuel's burning — the last of it. Whatever's left of their alert flight has nothing to save now and nothing to lose — if they weren't already coming, they are now. They are not coming to posture, Raptor.",
  546: "OVERLORD: Both of them, down in the dawn. That's the last sortie their air force had in it, Raptor 1-1 — the rest is arithmetic and rust. Come home in the sunlight.",
  547: "OVERLORD: Window's spent. Anything left in that yard is under camouflage nets by tonight, and the quiet is over for good. RTB, Raptor.",
  548: "RAPTOR 1-1: Run-in. ...It's beautiful out here, OVERLORD. Long red light, still air. You'd never know there was a war down there.",
  // 549 batch-4 rider (D-078 calcified-formula sweep): the verbatim "Five
  // minutes of window/light" opener had hit three strikes (549/559/579) —
  // 549 and 559 varied, 579 keeps the single surviving use.
  549: "OVERLORD: The sun is fully up in five minutes, Raptor, and their recovery crews move at first full light. Finish it.",

  // ---- V07 THE BELT (valdez-07) ----
  550: "THE BELT",
  551: "OVERLORD: Raptor 1-1, the western narrows are wearing a belt — two missile sites on the flats, dishes turning, covering every meter of water between them. The fleet comes home through those narrows next week. The belt comes off today.",
  552: "Site by the shore: one dish, two rails. Site on the west flat: dish, rail, and a gun keeping it company. Six pieces of iron, Raptor — the mission is all six, and every rail is live for as long as it exists.",
  553: "They'll see you the moment you drop into the bowl, so stop being polite about it. Break the rails and the dishes in whatever order keeps you alive — and when the last piece dies, expect their air to have opinions.",
  554: "OVERLORD: The Sound's flat as a workbench today. Run-in ahead — you'll cross into the shore site's envelope on the way down, so keep your break in your pocket.",
  // 555 batch-3 panel MUST-1: the median belt kill lands AFTER the pair has
  // left its hold, so the old "up behind the glacier line... Two fighters"
  // contradicted the radio's own picture — state/count-agnostic form.
  555: "OVERLORD: That's six for six — the belt is scrap and the narrows are naked. Whatever they still have airborne is coming here now — there's nowhere left for it to defend. The Sound is yours to keep, Raptor — keep it.",
  556: "OVERLORD: Splash two — their answer just ran out of sky. Nothing of theirs flies over these narrows again, Raptor 1-1. Come home when the ledger reads six and two.",
  557: "OVERLORD: We're out of afternoon, and the narrows are still contested — that's all the book will say. The fleet holds off. RTB, Raptor.",
  558: "RAPTOR 1-1: In the bowl. Tally both sites — dishes turning on the flats, rails trained on the water. They're wide awake, OVERLORD. Starting my work.",
  // 559 batch-4 rider: second of the two "Five minutes" variations (see 549).
  559: "OVERLORD: The afternoon is down to its last five minutes, Raptor 1-1. Anything on that flat or over it that answers to them has to be dead before the light goes.",

  // ---- V08 SECOND WIND (valdez-08) ----
  560: "SECOND WIND",
  561: "OVERLORD: Raptor 1-1, the guard channel found a ghost this morning: BOREAS is checking in over the Sound again — same voice, same perch, same appetite. Whether it's the same hands on the stick, nobody will swear to. Two of his hunters are already turning inbound to flush you out.",
  562: "The pattern is his to the letter: send the pair in low to make you spend and sweat, hold the perch high in the northwest, and come down like weather on whatever's left. High slasher. Supercruise thief. You know the file.",
  563: "Take the station, take his hunters, and then look up, Raptor. One way or the other, the Sound is done being his.",
  564: "OVERLORD: Station's ahead on the water. His pair is inbound from two sides — northeast and southwest, patient, like they've flushed people before. The perch hasn't moved.",
  565: "OVERLORD: Both hunters are in the water — and the guard channel just went dead quiet. That's not relief, Raptor. That's a man taking a breath. Expect the wind.",
  566: "OVERLORD: The Sound's high air is empty — however the wind went out, it's out. Station's yours, sky's yours, day's yours, Raptor 1-1. RTB.",
  567: "OVERLORD: Window's closed and the Sound is still contested air. Whoever's left up there gets to tell it their way tonight. Get down safe, Raptor — this one will keep.",
  568: "RAPTOR 1-1: On station. Two contacts converging on me — and if the file's right, one more up high I won't see until he wants me to. ...Good. I hate waiting.",
  // 569 batch-4 rider (D-078 register fix): the old taunt used JACKAL's
  // insurance/ledger vocabulary ("files a claim... collects") — swapped for
  // BOREAS's own elemental register, the panel's wording adopted.
  569: "BOREAS (guard): 'Little Raptor, back over my water. Storms don't die — they gather somewhere else and come back. Climb when you're ready.'",

  // ---- M07 THE EYE (marianas-07) ----
  570: "THE EYE",
  571: "OVERLORD: Raptor 1-1, the reason every move we make gets answered before we finish making it is orbiting the strait at twenty-five thousand feet — a converted heavy with a radar picture worth more than the rest of their air force. They call it the eye. Go put it out.",
  572: "It doesn't fly alone: two guards bracket the orbit, one high side each, the best sticks they have left. And somewhere south, low over the water, a ready pair holds for the day somebody tries exactly this.",
  573: "Kill the guards on your terms, then climb — it orbits high on purpose, and the climb is where cocky people die. The eye watches everything, Raptor. Make it watch this.",
  // 574 batch-4 rider: "[instrument] is honest" had calcified (534/574/584 —
  // 534 keeps the first use); 575 rider: "already moving" narrated a
  // pre-killable pair — the 509 either/or shape makes it path-true.
  574: "OVERLORD: Golden hour on the strait. The orbit track is steady on your nose, and both guards just took an interest in your heading. What you see is what's up — nobody out here is hiding except the pair down south.",
  575: "OVERLORD: Both guards are gone and nobody is answering the eye's calls. The deck pair is either already moving or already in the water — either way, it's tomorrow's problem arriving early. The eye is the mission, Raptor. Climb.",
  576: "OVERLORD: The eye is down — end over end, twenty-five thousand feet of tumbling scrap. Their whole theater just lost its sight, Raptor 1-1.",
  // 577 batch-4 rider: one of the 567/577 "Whoever's left up there...
  // tonight" twins varied (567 keeps the first use).
  577: "OVERLORD: We're out of golden hour with the job still open. The strait keeps its owner tonight, and it isn't us. RTB, Raptor — count your rails and your regrets on the way home.",
  578: "RAPTOR 1-1: On the datum. I can see it, OVERLORD — a fat silver cross way up high, going in circles like it owns the place. The near guard is already turning in. Starting my climb.",
  579: "OVERLORD: Five minutes of light left, Raptor. The job doesn't shrink in the dark — finish the count.",

  // ---- M08 TWO DOORS (marianas-08) ----
  580: "TWO DOORS",
  581: "OVERLORD: Raptor 1-1, the eye is gone and they know how this ends — so they're running. Four heavies came off the north field loaded with everything worth saving: staff, spares, the last of the war they wanted to have. Two pairs, two lanes — west for the open strait, south down the island line.",
  582: "The doors don't close together — call it six and a half minutes on the west lane, a shade under eight on the south, and you don't get to average them. Their last two fighters fly cover, one welded over each lane. The freight is the war, Raptor. The guns are just the argument.",
  583: "Pick a lane, kill it fast, and turn. There is no version of this where you fly it patient — and no version where one out of two is worth a debrief. Both pairs. Both doors stay shut.",
  // 584-586 batch-4 riders (D-078): 584 drops the second "[instrument] is
  // honest" (see 574); 585's closer gets the one-clause hedge so it stays
  // true if future debrief work un-masks win-tick lines; 586 loses "with
  // the channel mouth in sight" — on the reverse order it renders from
  // 30+ km away.
  584: "OVERLORD: The streams split off the north field before you were airborne — west pair's swinging wide over the water, south pair's down the island line, a gun riding over each. Neither clock waits on the other, Raptor. Pick.",
  585: "OVERLORD: West freight's in the water short of the mouth — that door stays shut for good. Half their getaway just became salvage, Raptor. Anything still driving the south lane is the other half of the job.",
  586: "OVERLORD: South freight is down in the shallows — the island line is finished as a way out. That was the sound of a theater running out of luck, Raptor 1-1.",
  587: "OVERLORD: A heavy is through the door and gone — open water, fleet umbrella, out of reach. What just left arrives somewhere else as next year's war. RTB, Raptor. We will be meeting that cargo again.",
  588: "OVERLORD: Clock call — anything still driving the west lane is inside two minutes of the mouth, and the south lane inside three. If you're going to be greedy, Raptor, now is the time.",
  589: "OVERLORD: Tracking steady — west pair is wide over the water turning down the coast, south pair is threading the islands, and the guns are running the lanes ahead of the freight. Four minutes on the near math.",

  // ---- 590-599: INC-8 batch-3 extras ----
  // 590 N07 wave-A merge clock (t=175, un-gated — box entry ≈ 271-287 s;
  //     conditional-form because a fast sweep can already have killed them)
  590: "OVERLORD: Anything still closing from the east is under two minutes from the bomber wheel. The heavies hold course regardless — that was the deal.",
  // 591 N07 wave-B backstop (t=395, un-gated — box entry ≈ 457-462 s;
  //     past-tense fact + conditional: they left the hold at ≈ 267-283 s
  //     and are killable after the turn, so the hedge is load-bearing)
  591: "OVERLORD: Their south element came off its hold at speed. If it's still flying, it's a minute from the bomber wheel — and it will not miss the freight.",
  // 592 N08 pair backstop (t=200, un-gated — gate crossing ≈ 206-220 s,
  //     ring ≈ 235-249 s; they hold >= 18 km from every likely player
  //     position until now, so an early kill is geometrically implausible)
  592: "OVERLORD: New tracks east, descending toward the basin — two of them, fast, and they are not conserving anything. Your quiet morning has about half a minute left in it.",
  // 593 V07 pair backstop (t=290, un-gated — ring ≈ 321-337 s). Batch-4
  // rider (D-078): the 592/593/596 "half a minute" triple is broken here —
  // past-tense spawn-fact + "under a minute", which also fixes the
  // wrong-side bound (real window 31-47 s).
  593: "OVERLORD: The pair that was holding behind the glacier line holds no longer — it's descending on the narrows, under a minute out if it's still coming. Sort your rails.",
  // 594 V08 BOREAS descent (t=330, un-gated — he left the perch ≈ 222 s,
  //     crosses the 18 km detection gate ≈ 365 s, ring ≈ 403 s: the call
  //     lands BEFORE the HUD can see him, which is the point). Batch-3
  //     panel MUST-2: he is killable before t=330 on a perch-first path,
  //     so the descent claim is conditional.
  594: "OVERLORD: The perch is empty, Raptor. If the wind still has hands, he's coming down the glacier line — high, fast, out of the noon sun — and you won't get a clean return until he's close. That's how he likes it.",
  // 595 V08 offense clock (t=1200, the 396-398 pattern)
  595: "OVERLORD: Five minutes, Raptor. Nobody remembers who held the station at lunch — they remember who owned the sky at the end of the day. Close it out.",
  // 596 M07 ready-pair backstop (t=300, un-gated — hold ends ≈ 250 s,
  //     ring ≈ 331-341 s). Batch-4 rider (D-078): pre-killable hedge in the
  //     591 if-still-flying shape — a completionist who pre-clears the
  //     south hold no longer gets radio narrating dead men.
  596: "OVERLORD: The southern hold is empty. If the ready pair is still flying, it's low on the water and seconds from your fight — two more sticks, same lesson.",
  // 597 M08 datum call (obj 1 done — honest about the detection gate: the
  //     south pair is inside 18 km at the datum, the west pair is not)
  597: "RAPTOR 1-1: On the datum. South pair's on my scope already; west pair's a bearing and a promise. ...You said pick. I pick both.",
  // 598 N07 PACKAGE LEAD join call (ON_TIME t=90 — the D-078 chair's id
  //     assignment: cashes the BIG FRIENDS title and turns 590's "that was
  //     the deal" into a callback)
  598: "PACKAGE LEAD: Copy the join, little friend. We hold course no matter what comes up — that's the deal. The sky out front is yours.",
  // 599 V07 mid-belt clock (ON_TIME t=160, state-agnostic — the D-078
  //     chair's id assignment: fills the batch-3 weakest arc's 220 s trough
  //     per the V06 trough law)
  599: "OVERLORD: However much of that belt is still standing, the narrows stay shut until it's none — and their air won't wait on your arithmetic forever.",

  // ==== INC-8 BATCH 4 — THE FINALE ====

  // ---- N09 THE SCHOOLHOUSE (nellis-09) ----
  600: "THE SCHOOLHOUSE",
  601: "OVERLORD: Raptor 1-1, the line is at their fence and they know it. Recon found their last armored reserve laagered under camouflage nets at the old western depot — the iron they were saving for the day we knocked. Burn it where it sleeps, and mind the flak wagon parked in the rows.",
  602: "Their air arm is ash — what's left is the schoolhouse: the aggressor squadron that taught this range to bite. The man who wrote its syllabus flies the watch himself now. Callsign VIPER. Energy is his whole religion — he climbs, he slashes, he does not turn twice.",
  603: "The watch is already airborne and inbound — call it two minutes of empty sky, and you'll spend most of it just getting there. His last two students hold south of the range with orders to die well. Kill the iron, beat the school — make this the last class.",
  604: "OVERLORD: Dusk on the range. Gate's ahead — long red light, long shadows, and a man somewhere out there pushing his throttle through the stops to make himself your problem.",
  605: "OVERLORD: The reserve is burning end to end — the last iron they had, gone under its own nets. The schoolhouse is all that's left of this war, Raptor, and anything it still flies, it spends on you tonight. Finish the lesson.",
  606: "OVERLORD: Both students down — the last class the schoolhouse will ever field. Hold what you're holding, Raptor 1-1. The range is almost quiet.",
  607: "OVERLORD: The light's spent and the job isn't. Anything still standing at that depot rolls for our fence tomorrow. Get down, Raptor — tomorrow just got expensive.",
  608: "RAPTOR 1-1: Through the gate. I can see the depot from here — netting over iron, dead straight rows. They parked their whole tomorrow in one field, OVERLORD.",
  609: "OVERLORD: Confirming the watch — VIPER came off the schoolhouse pad before you were feet-dry and he is not pacing himself. Expect him overhead the depot about when you are.",

  // ---- N10 PAID IN FULL (nellis-10) ----
  610: "PAID IN FULL",
  611: "OVERLORD: Raptor 1-1 — dawn, day one of the end. Our column is rolling for the eastern tunnel with the whole push on its flatbeds, and everything the enemy has left is spending itself to stop it: a scratch battery on the door, their last strike airframes, and one man you know. Clear the road.",
  612: "The battery went in overnight — one dish, two rails, dug in on the shelf above the tunnel. Their strike aircraft come for the column in waves, west and northwest, and they are not coming to duel you — they are coming to kill trucks. The column can lose one flatbed and still make the push. Lose two and we knock on that door next year.",
  613: "And the paint is up, Raptor. Whoever has flown it — the man, his ghost, his heir — it is airborne over the northwest range right now, and today it finally has something worth guarding. The column is the mission. The belt is the door. The paint is a debt, and today the ledger closes one way or the other.",
  614: "OVERLORD: First light on the basin floor. The column is ahead of you, lights off, rolling steady — from up there it must look like the whole war finally pointed one direction. It did.",
  615: "OVERLORD: The door is open — dish and rails are scrap on the shelf. If the paint is still up there, it just ran out of reasons to wait — and their strike wings never needed reasons. Nothing gets to the column, Raptor. Nothing.",
  616: "OVERLORD: The paint is off this range for good — one way or the other, that ledger is closed. Their strike wings can send what they like now; it won't be enough, and they know it. Drive on, column. Drive on.",
  617: "OVERLORD: Stand down, Raptor — the clock beat us. The column is still on the road, short of a door we couldn't clear in time, and dawn's gone gray. We pay for this one on the map. RTB.",
  618: "RAPTOR 1-1: Over the column — four flatbeds and everything we've got riding on them. Tell them to keep rolling no matter what they hear above them. I'll be everywhere I need to be.",
  619: "JACKAL (guard): 'One more dawn on my range, Raptor. I count four trucks, one door, and every promise this paint ever made. Whoever you think is flying it — today he keeps them.'",

  // ---- V09 DEADBOLT (valdez-09) ----
  620: "DEADBOLT",
  621: "OVERLORD: Raptor 1-1, the narrows have been naked a week and the enemy finally noticed. Two hulls are stopped in the homecoming lane — minelayers, seeding the water our fleet steams through in six days — and on the west flat somebody is bolting a new rail onto the belt's old bones. The door gets relocked today or it never does. Break the bolt.",
  622: "The battery first or the hulls first — your call, but know the trade: the rail on the flat is live NOW, and every hour the layers sit there the lane gets uglier for the sweepers. Six days, Raptor. They are betting we won't finish the job twice.",
  623: "Their air will not sit this out — intel holds a pair behind the glacier line with orders nobody has read. Assume they're coming. Sink, break, look up.",
  624: "OVERLORD: Flat gray water and a Sound pretending to be asleep. Run-in's ahead — that west-flat rail is live the moment you wander into its reach, so bring a plan and keep speed to spend.",
  625: "OVERLORD: Both layers are going down — the lane stays clean. And their air came off the glacier line minutes ago, Raptor — it is not coming to watch. Finish the list looking up.",
  626: "OVERLORD: Splash two — their answer ran out of sky over the water it came to keep. The list below you isn't going anywhere, Raptor 1-1 — finish it and come home.",
  627: "OVERLORD: Out of window, Raptor. The lock is still half-thrown — and half a lock still stops a fleet. Get down. We come back before they finish it, or the homecoming dies on paper.",
  628: "RAPTOR 1-1: Run-in point. I have the layers on the water — two wakes gone still, right in the throat of the lane. And there's smoke on the west flat, OVERLORD. They're working fast.",
  629: "OVERLORD: The glacier pair is done sightseeing — anything still descending out of that northwest is in your sky inside a minute. If your gun is busy, unbusy it.",

  // ---- V10 THE HOMECOMING (valdez-10) ----
  630: "THE HOMECOMING",
  631: "OVERLORD: Raptor 1-1, the fleet is home. ANCHORAGE and her tankers are holding at the narrows mouth — home water under their keels for the first time since this war had a name — and they stay exactly there until the sky says welcome. The enemy has one night left to matter, and they know it.",
  632: "Everything they still own is already airborne: three raids stacked out of the west arm, the glacier line, and the long way down the Sound — every airframe carrying one hull-killer and no manners. The arithmetic: a tanker can take one hit and no more, ANCHORAGE two. Nothing takes three. There is no second umbrella tonight, Raptor. There is you.",
  633: "Housekeeping first: their picket hulks still swing at our anchorage — skeleton iron, guns cold — and the fleet won't call this water home until they're on the bottom. Careful, Raptor: the hulks ride under a klick off ANCHORAGE's beam. Check fire on every pass. Guns for the hulks, nothing loose near the big hulls.",
  634: "OVERLORD: Gold water again, Raptor — the same light we held the narrows in, back when holding was all we could do. The fleet's at your nose, holding steady. The first raid is already working the west arm.",
  635: "OVERLORD: Second raid's in the water — and the guard channel just went loud. Everything that is left of them is committed down the long axis of the Sound, Raptor: the last wave of the last night. However many they are when they reach you — they don't get past you.",
  636: "OVERLORD: The last wave is in the water. Anything else still airborne out there is spent, empty, and running. Signal the fleet, Raptor 1-1 — tell them the sky is theirs.",
  637: "OVERLORD: A hull is burning at the narrows mouth. Two years, nineteen thousand miles, and the last mile is on fire. Get down, Raptor — some nights don't fit in a debrief.",
  638: "RAPTOR 1-1: Overhead the fleet. ANCHORAGE is flashing her lamp at me again, OVERLORD — same lamp, same water. This time nobody tell her to save the light. Let her burn it all night.",
  639: "OVERLORD: First pair is a heartbeat from its push — low, out of the west arm, running at ANCHORAGE. The lamp can wait, Raptor. Go to work.",

  // ---- M09 IN KIND (marianas-09) ----
  640: "IN KIND",
  641: "OVERLORD: Raptor 1-1, for once the vector is zero — they are coming HERE. Their naval-air remnant is airborne off the north field, the same strip their heavies ran from, and its target list is one line long: the Andersen flightline. Four bowsers of jet fuel between this island and a grounded tomorrow.",
  642: "The picture reads two pulses: a lead pair already driving down the island line, and the main raid behind it — three more strike airframes and, riding wide of them, the two fighters nobody believed they still had. Real ones, Raptor. The kind they've been saving.",
  643: "The math is unforgiving: two bowsers dead and Andersen stops flying — which means nothing gets through, not once, not on a good excuse. Take the station northeast and meet them in the water gap. In kind, Raptor — pay them back in kind.",
  644: "OVERLORD: High noon over the strait, nothing between you and them but climb and closure. Station's ahead. The lead pair is real and inbound — the plot has them coming down the island line, low.",
  645: "OVERLORD: Lead pair's in the water — and nobody is turning around, Raptor. The main raid is still inbound — it launched three across — and somewhere east of it their fighters are choosing their moment. Hold the gap.",
  646: "OVERLORD: The raid is in the water — every airframe that came for the fuel. Whatever their fighters do now, they do it for nobody, Raptor 1-1. Andersen flies tomorrow. So does everything else.",
  647: "OVERLORD: The flightline is burning — two bowsers gone, and this island just became a spectator. Get down while there's still a strip to get down on, Raptor.",
  648: "RAPTOR 1-1: On station in the gap, picture building north. All war long we've flown to them, OVERLORD — today the commute is theirs.",
  649: "OVERLORD: The lead pair is through the mid-chain and letting down — anything still flying that vector is under a minute from its push. Meet it short of the fuel, Raptor.",

  // ---- M10 TYPHOON (marianas-10) ----
  650: "TYPHOON",
  651: "OVERLORD: Raptor 1-1. The eye is out, the doors are shut, the runners are salvage — and last night their fleet flagship weighed anchor with the theater command aboard, made open water west of the chain, and stopped. She holds station there with the last screen they own — because he told them to. TYPHOON is airborne on the storm line north of that fleet. The last name on the board. He has flown over their navy since the first morning of this war, he has never once come south to us, and everyone who went north to him stayed.",
  652: "The mission is two names, one water: put the flagship group on the bottom — screen first, if you plan on growing old — and put TYPHOON in the water beside it. Hear that part twice, Raptor: HIM, in the water. Driven off has always been enough. Not today. If he leaves this map alive, the war doesn't end — it just moves somewhere we can't follow, and waits.",
  653: "What the file says: he takes a hit that folds better men and keeps flying — and when he's hurt, he doesn't defend, he RUNS: cold, flat-out, for the edge of the map, and nobody has ever caught him. So get close before you get greedy, fight him over the fleet where the light is yours, and when you finally hurt him — finish it in the same breath. Fastest hands in either hemisphere. Fly perfect, Raptor. He will.",
  654: "OVERLORD: Golden hour, glass strait. Datum's ahead, the fleet beyond it — and mind the last Saipan gun on the straight line home: dogleg your rearm runs. Quiet from here to the push, Raptor. Let's not tell him more than he already knows.",
  // 655: polish rider 2 — fleet-state agnostic (on a flagship-first path
  //     the old line narrated a ship already underwater); the seat's
  //     dark-true form adopted.
  655: "OVERLORD: The screen is gone — three hulls down, and whatever of that fleet still floats is alone with the whole golden hour left. Wherever he is, Raptor — the water or the sky — he can't save any of it. Take the war apart.",
  656: "OVERLORD: Confirmed, Raptor — TYPHOON is in the water. The best they ever made just ran out of sky and excuses in the same minute. Anything of that fleet still floating floats blind, deaf, and last. Finish the ledger and come home.",
  657: "OVERLORD: Time, Raptor. The gold's gone, and the piece of this war we didn't finish is still out there in the dark. Get down. Nobody sleeps tonight.",
  658: "RAPTOR 1-1: On the datum. I can see them, OVERLORD — the whole last fleet in one square of gold water. If the file is right, he's up there somewhere deciding how this ends. Let's go disappoint him. Starting my run.",
  659: "OVERLORD: FLAGSHIP'S GOING DOWN — she's rolling, Raptor, deck lights burning all the way under. The theater command just became history's problem. If the sky still has a name in it, it has nothing left to guard — expect everything.",

  // ---- 660-663: VIPER ace set (taunt / smoking / escaped / killed) ----
  660: "VIPER (guard): 'New voice on my range. I wrote the book they teach down there, little Raptor — tonight you get the oral exam. Climb when you see me. It won't help.'",
  661: "VIPER (guard): 'Good answer, little Raptor. But the exam has more than one question.'",
  // 662: panel MUST-4 — direction-agnostic (engine-verified: B_BINGO runs
  // for the NEAREST edge, which from VIPER's laager fight is always west
  // or north, never east).
  662: "OVERLORD: VIPER is running for the fence, smoking, throttle wide open — the instructor just walked out of his own class. Let him tell that story, Raptor.",
  663: "OVERLORD: SPLASH VIPER. The man who taught this range to bite just hit his own floor. School's out, Raptor — for good.",

  // ---- 664-668: TYPHOON ace set (taunt / smoking / bingo / escaped /
  // killed). The bingo hook is the beat that RENDERS: one 9X takes an ace
  // 120 -> 30, skipping the 40-60 smoking band entirely, and the escaped /
  // failed lines land on the lose tick (masked — main.js hides the feed at
  // match.over), so 666 carries the chase and 668 is written for the ring
  // and any future debrief un-masking. 667 spends RAPTOR's '...' pivot tic —
  // its fourth and final use, per the D-078 chair's ruling.
  // 664: panel MUST-3 — TYPHOON refuses the pet name (BOREAS owns "little
  // Raptor" (384/569), VIPER borrows it twice this batch (660/661)); to
  // TYPHOON you are weather, not a callsign.
  664: "TYPHOON (guard): 'So you're the weather they finally sent. I watched you break their squalls one front at a time, and I let them go — a storm doesn't chase. It waits at the center, and everything comes to the center. You're coming. I'm already here.'",
  665: "TYPHOON (guard): 'First blood in two years to touch this airframe. Good. It should cost something to end a war.'",
  666: "OVERLORD: HE'S HIT — cold, burners lit, running flat-out for the nearest fence, and if he makes it, the war never closes. At his speed you have a minute, maybe less. RUN HIM DOWN, RAPTOR. RUN HIM DOWN.",
  667: "RAPTOR 1-1: Splash TYPHOON. He's in the water with his fleet. ...It's just weather now, OVERLORD. It's just weather.",
  668: "OVERLORD: He's across the fence, alive, gone. There was one way for this war to stay unfinished, Raptor, and it just flew off the map. Come home. We'll be looking over our shoulders for years.",

  // ---- 669-689: batch-4 extras (un-gated backstops, clocks, finale ace
  // lines — every clock idiom varied, no fourth "Five minutes" opener) ----
  // 669 M10 descent backstop (t=150, un-gated — TYPHOON leaves the storm
  //     line ≈ 119 s, crosses the 18 km gate ≈ 164 s, 10 km group ring
  //     ≈ 198 s: the call lands before the HUD can paint him)
  669: "OVERLORD: TYPHOON has come off the storm line — descending on the fleet, high and sun-side, and your scope won't paint him for a few breaths yet. Set up your next run knowing he's in it.",
  // 670 M10 offense clock (t=1200 — varied shape)
  670: "OVERLORD: Quarter left in the golden hour, Raptor. A war this long shouldn't end in the dark — put what's left of it in the water while the water still shines.",
  // 671 N09 offense clock (t=1200 — varied shape)
  671: "OVERLORD: Clock check, Raptor — the sun's on the fence and it's taking your window with it. The range still owes you a finished job. Collect it now.",
  // 672 N09 students backstop (t=310, un-gated — they leave the southern
  //     hold ≈ 237-239 s, 11 km laager-ring entry ≈ 382-401 s)
  672: "OVERLORD: Their last pair came off the southern hold a minute back. If any of it is still flying, it's riding the dusk down onto the depot fire — count your rails, Raptor.",
  // 673 N10 wave-1 clock (t=170, un-gated — dive commit ≈ 219-229 s)
  673: "OVERLORD: The first strike element was airborne before your wheels were up — two contacts out of the west, low, their line running straight over the column. Anything of it still airborne is a minute out. Be in the way.",
  // 674 N10 wave-2 backstop (t=355, un-gated — dive commit ≈ 390-396 s)
  674: "OVERLORD: The second strike element came off the northwest weather minutes ago — however much of it is still committed, it's on the column's line with a minute of gap left. Everything else in your sky can wait.",
  // 675 N10 column-loss defeat (protect need 2)
  675: "OVERLORD: A second flatbed is burning and the column is combat-ineffective. The push just died on its own road, Raptor. Get down — some mornings the map wins.",
  // 676 N10 JACKAL finale smoking taunt (fresh — 449's column line reads
  //     wrong when the column is OURS)
  676: "JACKAL (guard): 'Smoke. This airplane has worn worse — every scar on this paint has your name somewhere in it. Not finished, Raptor. The paint is never finished.'",
  // 677 N10 offense clock (t=1200 — varied shape)
  677: "OVERLORD: Sun's fully up and the window is going with it, Raptor. The list between the column and that tunnel doesn't shrink on its own — end it, or the map ends us.",
  // 678/679 N10 JACKAL finale escaped / killed (the 382/383 thread closes
  //     with finale-specific lines instead of a fourth verbatim reuse)
  678: "OVERLORD: The paint is running for the fence trailing smoke — no range left to haunt, nowhere to land that isn't ours by lunch. Let it go, Raptor. The ledger closes either way today.",
  679: "OVERLORD: SPLASH JACKAL — paint, pilot, promise and all. The range changed owners for the last time, Raptor. It's done. It's paid.",
  // 680 V09 offense clock (t=1200 — varied shape)
  680: "OVERLORD: The afternoon is folding up, Raptor. What's left of the lock gets finished in the dark by their hands or right now by yours. Choose yours.",
  // 681 V09 mid-job clock (t=170, un-gated, state-agnostic — the 599
  //     trough-law pattern)
  681: "OVERLORD: Keep the count in your head, Raptor — one rail, one dish, two hulls. Every one still on the board is a bolt half-thrown. Work.",
  // 682 N10 JACKAL descent backstop (t=305, un-gated — descent legs begin
  //     ≈ 270-315 s, 11 km corridor-ring entry ≈ 341 s)
  // 682: polish rider 4 — dawn-geometry honesty (todH 7.5, sun EAST: a
  //     northwest descent puts the dawn in JACKAL's face, not on his back).
  682: "OVERLORD: The paint's sweep line has gone quiet, Raptor. If it's still flying, it's descending out of the northwest with the dawn full in its face — and it's coming anyway.",
  // 683 V10 wave-2 backstop (t=390, un-gated — dive commit ≈ 420-429 s)
  // 683: polish rider 5 — clock honesty (fires t=390 vs dive commits
  //     420-429 s: "less than a minute" is true across the band; the
  //     banned "half a minute" stays banned).
  683: "OVERLORD: Raid two is through the west-arm turns — anything of it still flying is on the deck, tracking the tankers, with less than a minute of water in front of it.",
  // 684 V10 wave-3 backstop (t=490, un-gated — 18 km gate ≈ 465-470 s,
  //     dive commit ≈ 508-512 s)
  // 684: panel MUST-5 — the wave-3 target split is briefed, not withheld
  //     (protect need-1 and the tier-3 carries ANCHORAGE's fatal third hit;
  //     a first-attempt defeat must never ride on hidden targeting).
  684: "OVERLORD: Whatever's left of the last raid is down the coast and turning in — two hunting the tankers, and one with ANCHORAGE's name on it, faster than the rest. Count them as they come, Raptor, and make every count smaller — this is the one they tell both stories about.",
  // 685 V10 defense-timeout VICTORY flavor (t=1500, the 399 pattern — the
  //     one designed V01 echo, closing the front on its own motto)
  685: "OVERLORD: That's the night, Raptor — the raids are spent, the fleet is untouched, and the gold never left the water. If any of their iron still floats out there, it floats alone. The narrows held. They always will.",
  // 686 V10 pickets-done beat (obj 2 — renders mid-sortie on the median)
  686: "OVERLORD: Both hulks on the bottom — the anchorage is a home port now, not a front line. Somewhere below you a very tired signal lamp just said thank you.",
  // 687 M09 defense-timeout VICTORY flavor (t=1500, the 399 pattern)
  687: "OVERLORD: Window's closed, Raptor — the raid is spent, the fuel never burned, and their fighters, if any are left, have nothing to escort but the story. That was their last reach. It came up a strait short. RTB.",
  // 688 M09 wave-2 backstop (t=340, un-gated — dive commit ≈ 374-382 s)
  688: "OVERLORD: The main raid is through its last turn — however much of it is left, it's low and spread wide across the gap. Your window on each is a minute wide and closing, and they will not arrive in single file.",
  // 689 M09 escort call (t=255, un-gated — the guns leave their holds
  //     ≈ 235-251 s, 11 km station-ring entry ≈ 281-286 s)
  689: "OVERLORD: Their fighters just came off the hold east of you — two, fast, wide abeam the raid line. They're not escorting anymore, Raptor. They're coming to clear the sky for it — and the sky is you.",

  // ---- 716-717: finale-panel riders (D-079 MUSTs + polish riders) ----
  // 716 N10 JACKAL bingo beat (panel MUST-2): on the median 9X path
  //     120 -> 30 skips the smoking band, so 676 never fires and the
  //     NELLIS finale duel would resolve with zero rendered radio — the
  //     bingo hook renders on every hit path, ~40+ s before resolution.
  716: "OVERLORD: The paint is hit — it's broken off and running for the fence with everything the engine has left. Let it cross and driven off is done; the column still gets its dawn. But the debt crosses with it, Raptor. Collect it now or carry it forever. Your ledger.",
  // 717 N09 VIPER bingo beat (polish rider 1): makes the OPTIONAL
  //     for-keeps chase visible during its window — unlike N10/M10, letting
  //     him cross costs nothing but the ledger, and the line says so.
  717: "OVERLORD: VIPER's hit and running for the fence. Let him carry the lesson home, Raptor — or go write the last line of the syllabus yourself. Your fuel, your call.",

  // ---- 690-715: LABEL BANK (objective labelId -> HUD row text; shared
  // across sorties by design — one id, one utterance, VO-ready; PROTECT
  // rows render amber while pending via main.js) ----
  690: "THE GATE",
  691: "THE RUN-IN",
  692: "FIRST WAVE",
  693: "SECOND WAVE",
  694: "THE LAST WAVE",
  695: "THE COLUMN",
  696: "THE FLEET",
  697: "THE FLIGHTLINE",
  698: "THE RESERVE",
  699: "THE WATCH",
  700: "THE LAST CLASS",
  701: "VIPER — FOR KEEPS",
  702: "THE DOOR BELT",
  703: "THE DEBT — FOR KEEPS",
  704: "THE BATTERY",
  705: "THE MINELAYERS",
  706: "THE ANSWER",
  707: "THE PICKETS",
  708: "ON STATION",
  709: "THE SCREEN",
  710: "THE FLAGSHIP",
  711: "TYPHOON — NO ESCAPE", // polish rider 3: the mandatory-kill/loseWhen stakes on the HUD (M10-only label, vs N09's optional chase)
  712: "THE DATUM",
  713: "THE PAINT",
  714: "FIRST STRIKE",
  715: "SECOND STRIKE",
};

// alias for the authored loader (campaign/authored.js reads L.LINES first)
export const LINES = SORTIE_LINES;

export default SORTIE_LINES;

// What everybody says. Pure flavour — render.js pops a speech bubble when the
// engine reports an event, and nothing here can affect a match.
//
//   critter / bug   the default lines for each side
//   own             per-critter overrides, so favourites have a voice
//
// Keep every line under about 14 characters: the bubble sits on a 40px tile.

const CHATTER = {
  critter: {
    hit:    ["Bonk!", "Gotcha!", "Take that!", "Hiyah!", "Boop!"],
    hurt:   ["Ouch!", "Eep!", "Oof!", "That stings!", "Yikes!"],
    splash: ["Bye bye!", "Swim time!", "Splash!"],
    berry:  ["Nom!", "Yum!", "Mine!"],
    power:  ["Watch this!", "Ta-da!", "Here goes!"],
    win:    ["We did it!", "Hooray!", "Best team!"],
  },
  bug: {
    hit:    ["Chomp!", "Grrr!", "Bzzt!", "Nibble!"],
    hurt:   ["Owww!", "Eek!", "No fair!", "Buzz off!"],
    splash: ["Glub glub…", "I can't swim!", "Bloop."],
    power:  ["Sssss!", "Skitter!"],
  },
  own: {
    hop:     { hit: ["Boing!", "Hop hop!"], power: ["Sluuurp!", "Come here!"], splash: ["In you go!"] },
    digger:  { hit: ["THUMP!", "Smash!"], power: ["EARTHQUAKE!", "Rumble!"], hurt: ["Barely felt it."] },
    zip:     { hit: ["Peck!", "Tweet!"], power: ["Whoooosh!", "Fly away!"], splash: ["Have a bath!"] },
    prickle: { hit: ["Prickle!", "Spiky!"], power: ["Rolling!", "Wheee!"], hurt: ["That's spiky of you."] },
    buzz:    { hit: ["Sting!", "Bzz!"], power: ["Feel better!", "All patched up!"] },
  },
};

const assert = require('node:assert');
const { parseLootExport } = require('../src/parseLoot');

const sample = `player,date,time,id,item,itemID,itemString,response,votes,class,instance,boss,difficultyID,mapID,groupSize,gear1,gear2,responseID,isAwardReason,subType,equipLoc,note,owner
Pluttman-Spineshatter,2026/07/12,20:33:00,1783881295-3,[Chestguard of the Vanquished Defender],30237,item:30237::::::::70,Bis,0,WARRIOR,Tempest Keep-25 Player,Kael'thas Sunstrider,4,550,25,|cffa335ee|Hitem:29019:2661:24058:24067:24067::::70::::::::::|h[Warbringer Breastplate]|h|r,,1,false,Armor Token,,"bis till sunwell, har 4/5",Suediorre-Spineshatter
Frallfarseer-Spineshatter,2026/07/12,22:22:00,1783887796-11,[Helm of the Vanquished Champion],30242,item:30242::::::::70,Bis,0,SHAMAN,Coilfang: Serpentshrine Cavern-25 Player,Lady Vashj,4,548,25,|cffa335ee|Hitem:29028:3001:25901:24065:::::70::::::::::|h[Cyclone Headdress]|h|r,,1,false,Armor Token,,har 2 utav 3,Suediorre-Spineshatter
Mccormack-Spineshatter,2025/11/05,22:16:00,1762377468-9,[The Face of Death],23043,item:23043::::::::60,BiS,0,WARRIOR,Eastern Kingdoms-,Kel'Thuzad,0,0,0,|cffa335ee|Hitem:21269:929:::::::60::::::::::|h[Blessed Qiraji Bulwark]|h|r,,1,false,Shields,Off Hand,,Vpk-Spineshatter
`;

const items = parseLootExport(sample);

assert.strictEqual(items.length, 3);
assert.strictEqual(items[0].player, 'Pluttman-Spineshatter');
assert.strictEqual(items[0].itemName, 'Chestguard of the Vanquished Defender');
assert.strictEqual(items[0].itemId, 30237);
assert.strictEqual(items[0].response, 'Bis');
assert.strictEqual(items[0].boss, "Kael'thas Sunstrider");
assert.strictEqual(items[0].note, 'bis till sunwell, har 4/5'); // quoted field with embedded comma
assert.strictEqual(items[1].class, 'SHAMAN');

assert.strictEqual(items[2].player, 'Mccormack-Spineshatter');
assert.strictEqual(items[2].date, '2025/11/05');
assert.strictEqual(items[2].owner, 'Vpk-Spineshatter');
assert.strictEqual(items[2].itemName, 'The Face of Death');
assert.strictEqual(items[2].previousItem, 'Blessed Qiraji Bulwark');

const gargulSample = `[{"OS":true,"PL":false,"SR":false,"TMB":false,"WL":false,"awardedBy":"Pluttman-Spineshatter","awardedTo":"Willtoto-Spineshatter","checksum":"26499530761331179210","isBonusLoot":false,"itemGUID":"Item-6412-0-4000000284EE9279","itemID":28506,"itemLink":"[Gloves of Dexterous Manipulation]","received":true,"softresID":"y6t6q2","timestamp":1781292052,"winnerClass":3,"winningRollType":"OS"},{"OS":true,"PL":false,"SR":false,"TMB":false,"WL":false,"awardedBy":"Pluttman-Spineshatter","awardedTo":"Ñæððøç-Spineshatter","checksum":"22898505903350882708","isBonusLoot":false,"itemGUID":"Item-6412-0-4000000284F42D98","itemID":28611,"itemLink":"[Dragonheart Flameshield]","received":false,"softresID":"y6t6q2","timestamp":1781294457,"winnerClass":7,"winningRollType":"OS"},{"OS":true,"PL":false,"SR":false,"TMB":false,"WL":false,"awardedBy":"Pluttman-Spineshatter","awardedTo":"Fulfrans-Spineshatter","checksum":"32522651224694852000","isBonusLoot":false,"itemID":28611,"itemLink":"[Dragonheart Flameshield]","received":true,"softresID":"y6t6q2","timestamp":1781294473,"winnerClass":7,"winningRollType":"OS"}]`;

const gargulItems = parseLootExport(gargulSample);

assert.strictEqual(gargulItems.length, 2); // the received:false correction row is dropped
assert.strictEqual(gargulItems[0].player, 'Willtoto-Spineshatter');
assert.strictEqual(gargulItems[0].class, 'HUNTER');
assert.strictEqual(gargulItems[0].itemName, 'Gloves of Dexterous Manipulation');
assert.strictEqual(gargulItems[0].itemId, 28506);
assert.strictEqual(gargulItems[0].response, 'OS');
assert.strictEqual(gargulItems[0].owner, 'Pluttman-Spineshatter');
assert.strictEqual(gargulItems[0].date, '2026/06/12'); // from unix timestamp

assert.strictEqual(gargulItems[1].player, 'Fulfrans-Spineshatter');
assert.strictEqual(gargulItems[1].itemName, 'Dragonheart Flameshield');

const rcJsonSample = JSON.stringify([{
  player: 'Ovethewhite-Spineshatter', date: '2026/04/12', time: '19:35:00', itemID: 29763,
  response: 'Bis', class: 'PALADIN', instance: "Magtheridon's Lair-25 Player", boss: 'Magtheridon',
  gear1: '[Pauldrons of the Solace-Giver]', gear2: '', note: 'Får 2 set-bonus BIS',
  owner: 'Suediorre-Spineshatter', itemName: 'Pauldrons of the Fallen Champion',
}]);

const rcJsonItems = parseLootExport(rcJsonSample);

assert.strictEqual(rcJsonItems.length, 1);
assert.strictEqual(rcJsonItems[0].player, 'Ovethewhite-Spineshatter');
assert.strictEqual(rcJsonItems[0].itemName, 'Pauldrons of the Fallen Champion');
assert.strictEqual(rcJsonItems[0].itemId, 29763);
assert.strictEqual(rcJsonItems[0].boss, 'Magtheridon');
assert.strictEqual(rcJsonItems[0].note, 'Får 2 set-bonus BIS'); // non-ASCII survives JSON untouched
assert.strictEqual(rcJsonItems[0].previousItem, 'Pauldrons of the Solace-Giver');
assert.strictEqual(rcJsonItems[0].owner, 'Suediorre-Spineshatter');

console.log('parseLoot: all assertions passed');

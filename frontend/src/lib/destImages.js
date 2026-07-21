export const DEST_IMAGES = [
  "https://images.pexels.com/photos/13543496/pexels-photo-13543496.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
  "https://images.unsplash.com/photo-1683009427590-dd987135e66c?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.unsplash.com/photo-1682685797229-b2930538da47?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.unsplash.com/photo-1623784373624-26fb62d3076d?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.unsplash.com/photo-1663071999931-dccb6c9cf0e7?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.pexels.com/photos/14974644/pexels-photo-14974644.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
  "https://images.unsplash.com/photo-1652454183366-810876648558?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.unsplash.com/photo-1625726411847-8cbb60cc71e6?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.unsplash.com/photo-1716611342057-ed83a6fa814b?crop=entropy&cs=srgb&fm=jpg&q=85&w=940",
  "https://images.pexels.com/photos/34648466/pexels-photo-34648466.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
  "https://images.pexels.com/photos/31965912/pexels-photo-31965912.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
];

export const HERO_IMAGE =
  "https://static.prod-images.emergentagent.com/jobs/2b6fe9a7-d8ff-4309-bb0e-2b0996d46492/images/7b3cfee188934e958493f7f2f254fe394ffa4419f9b8470dde4d72cb40ac39a7.jpeg";

export function imageFor(key) {
  let h = 0;
  const s = String(key || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return DEST_IMAGES[h % DEST_IMAGES.length];
}

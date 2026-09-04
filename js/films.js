// ---------------------------------------------------------------------------
//  Film library.
//
//  Every name, family and warranty figure below is taken from the Carla's USA
//  catalogue (carlasusa.com), which Jarek's installs. Swatch images are the
//  manufacturer's own material photographs. Nothing here is invented — where a
//  characteristic could not be verified it is simply absent.
// ---------------------------------------------------------------------------

export const CLEAR = [
  { code: 'GT Clear',        warranty: '10 år', finish: { no: 'Blank',  en: 'Gloss' } },
  { code: 'GT Clear HD',     warranty: '10 år', finish: { no: 'Blank',  en: 'Gloss' } },
  { code: 'GT Satin',        warranty: '10 år', finish: { no: 'Satin',  en: 'Satin' } },
  { code: 'GT Clear 5 Year', warranty: '5 år',  finish: { no: 'Blank',  en: 'Gloss' } }
];

export const COLOUR = [
  // --- Premium Gloss ------------------------------------------------------
  { slug:'super-black',          name:'Super Black / Piano Black', group:'gloss', hex:'#030303', img:'assets/film/super-black.webp' },
  { slug:'midnight-emerald',     name:'Midnight Emerald',          group:'gloss', hex:'#091317', img:'assets/film/midnight-emerald.webp' },
  { slug:'marina-bay-blue',      name:'Marina Bay Blue',           group:'gloss', hex:'#050B33', img:'assets/film/marina-bay-blue.webp' },
  { slug:'goodwood-green-pearl', name:'Goodwood Green Pearl',      group:'gloss', hex:'#070707', img:'assets/film/goodwood-green-pearl.webp' },
  { slug:'nardo-gray',           name:'Nardo Gray',                group:'gloss', hex:'#5A595E', img:'assets/film/nardo-gray.webp' },
  { slug:'porsche-crystal-blue', name:'Porsche Crystal Blue',      group:'gloss', hex:'#6E8596', img:'assets/film/porsche-crystal-blue.jpg' },
  { slug:'ferrari-red',          name:'Ferrari Red',               group:'gloss', hex:'#FE1F27', img:'assets/film/ferrari-red.webp' },

  // --- Premium Satin ------------------------------------------------------
  { slug:'frozen-black',         name:'Frozen Black',              group:'satin', hex:'#2A2829', img:'assets/film/frozen-black.webp' },
  { slug:'frozen-leaden-gray',   name:'Matte Frozen Leaden Gray',  group:'satin', hex:'#5C5B64', img:'assets/film/frozen-leaden-gray.webp' },
  { slug:'olive-green',          name:'Matte Olive Green',         group:'satin', hex:'#424439', img:'assets/film/olive-green.webp' },
  { slug:'romanee-red',          name:'Matte Romanée Red',         group:'satin', hex:'#5B0D13', img:'assets/film/romanee-red.webp' },
  { slug:'frozen-white-silver',  name:'Matte Frozen White Silver', group:'satin', hex:'#6C6460', img:'assets/film/frozen-white-silver.webp' },
  { slug:'satin-rose-gold',      name:'Tesla Satin Rose Gold',     group:'satin', hex:'#C6B0A8', img:'assets/film/satin-rose-gold.webp' },

  // --- Designer Series ----------------------------------------------------
  { slug:'forged-carbon-black',  name:'Forged Carbon Black',       group:'designer', hex:'#3A3839', img:'assets/film/forged-carbon-black.webp' }
];

export const GROUPS = {
  gloss:    { no: 'Blank',          en: 'Gloss',           count: 155 },
  satin:    { no: 'Satin og matt',  en: 'Satin and matte', count: 34  },
  designer: { no: 'Designer',       en: 'Designer',        count: 24  }
};

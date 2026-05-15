export const nigeriaStateOptions = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Federal Capital Territory",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara"
] as const;

export type NigeriaState = (typeof nigeriaStateOptions)[number];

export const nigeriaLgaOptionsByState: Record<NigeriaState, readonly string[]> = {
  'Abia': ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obioma Ngwa', 'Ohafia', 'Osisioma Ngwa', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umu-Nneochi', 'Umuahia North', 'Umuahia South'],
  'Adamawa': ['Demsa', 'Fufore', 'Ganye', 'Girei', 'Gombi', 'Guyuk', 'Hong', 'Jada', 'Lamurde', 'Madagali', 'Maiha', 'Mayo-Belwa', 'Michika', 'Mubi North', 'Mubi South', 'Numan', 'Shelleng', 'Song', 'Toungo', 'Yola North', 'Yola South'],
  'Akwa Ibom': ['Abak', 'Eastern Obolo', 'Eket', 'Esit Eket', 'Essien Udim', 'Etim Ekpo', 'Etinan', 'Ibeno', 'Ibesikpo Asutan', 'Ibiono Ibom', 'Ika', 'Ikono', 'Ikot Abasi', 'Ikot Ekpene', 'Ini', 'Itu', 'Mbo', 'Mkpat Enin', 'Nsit Atai', 'Nsit Ibom', 'Nsit Ubium', 'Obat Akara', 'Okobo', 'Onna', 'Oron', 'Oruk Anam', 'Udung Uko', 'Ukanafun', 'Uruan', 'Urue Offong/Oruk', 'Uyo'],
  'Anambra': ['Aguata', 'Anambra East', 'Anambra West', 'Aniocha', 'Awka North', 'Awka South', 'Ayamelum', 'Dunukofia', 'Ekwusigwo', 'Idemili North', 'Idemili South', 'Ihiala', 'Njikoka', 'Nnewi North', 'Nnewi South', 'Ogbaru', 'Onisha North', 'Onisha South', 'Orumba North', 'Orumba South', 'Oyi'],
  'Bauchi': ['Alkaleri', 'Bauchi', 'Bogoro', 'Damban', 'Darazo', 'Dass', 'Gamawa', 'Ganjuwa', 'Giade', 'I/Gadau', 'Jama\'Are', 'Katagum', 'Kirfi', 'Misau', 'Ningi', 'Shira', 'Tafawa Balewa', 'Toro', 'Warji', 'Zaki'],
  'Bayelsa': ['Brass', 'Ekermor', 'Kolokuma/Opokuma', 'Nembe', 'Ogbia', 'Sagbama', 'Southern Ijaw', 'Yenagoa'],
  'Benue': ['Ado', 'Agatu', 'Apa', 'Buruku', 'Gboko', 'Guma', 'Gwer East', 'Gwer West', 'Katsina Ala', 'Konshisha', 'Kwande', 'Logo', 'Makurdi', 'Obi (Benue)', 'Ogbadibo', 'Ohimini', 'Oju', 'Okpokwu', 'Otukpo', 'Tarka', 'Ukum', 'Ushongo', 'Vandeikya'],
  'Borno': ['Abadan', 'Askira Uba', 'Bama', 'Bayo', 'Biu', 'Chibok', 'Damboa', 'Dikwa', 'Gubio', 'Guzamala', 'Gwoza', 'Hawul', 'Jere', 'Kaga', 'Kala Balge', 'Konduga', 'Kukawa', 'Kwaya Kusar', 'Mafa', 'Magumeri', 'Maiduguri Metro', 'Marte', 'Mobbar', 'Monguno', 'Ngala', 'Nganzai', 'Shani'],
  'Cross River': ['Abi', 'Akamkpa', 'Akpabuyo', 'Bakassi', 'Bekwara', 'Biase', 'Boki', 'Calabar Municipal', 'Calabar South', 'Etung', 'Ikom', 'Obanliku', 'Obubra', 'Obudu', 'Odukpani', 'Ogaja', 'Yakurr', 'Yala'],
  'Delta': ['Aniocha North', 'Aniocha South', 'Bomadi', 'Burutu', 'Ethiope East', 'Ethiope West', 'Ika North East', 'Ika South', 'Isoko North', 'Isoko South', 'Ndokwa East', 'Ndokwa West', 'Okpe', 'Oshimili North', 'Oshimili South', 'Patani', 'Sapele', 'Udu', 'Ughelli North', 'Ughelli South', 'Ukwuani', 'Uvwie', 'Warri North', 'Warri South', 'Warri South West'],
  'Ebonyi': ['Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North', 'Ezza South', 'Ikwo', 'Ishielu', 'Ivo', 'Izzi', 'Ohaozara', 'Ohaukwu', 'Onicha'],
  'Edo': ['Akoko Edo', 'Egor', 'Esan Central', 'Esan North East', 'Esan South East', 'Esan West', 'Etsako Central', 'Etsako East', 'Etsako West', 'Igueben', 'Ikpoba Okha', 'Oredo', 'Orhionwon', 'Ovia North East', 'Ovia South West', 'Owan East', 'Owan West', 'Uhunmwode'],
  'Ekiti': ['Ado Ekiti', 'Aiyekire', 'Efon', 'Ekiti East', 'Ekiti South West', 'Ekiti West', 'Emure', 'Ido-Osi', 'Ijero', 'Ikere', 'Ikole', 'Ilejemeji', 'Irepodun/Ifelodun', 'Ise/Orun', 'Moba', 'Oye'],
  'Enugu': ['Agwu', 'Aninri', 'Enugu East', 'Enugu North', 'Enugu South', 'Ezeagu', 'Igbo Etiti', 'Igbo Eze North', 'Igbo Eze South', 'Isi Uzo', 'Nkanu East', 'Nkanu West', 'Nsukka', 'Oji River', 'Udenu', 'Udi', 'Uzo Uwani'],
  'Federal Capital Territory': ['Abaji', 'Abuja Municipal', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali'],
  'Gombe': ['Akko', 'Balanga', 'Billiri', 'Dukku', 'Funakaye', 'Gombe', 'Kaltungo', 'Kwami', 'Nafada', 'Shomgom', 'Yamaltu/Deba'],
  'Imo': ['Aboh Mbaise', 'Ahiazu Mbaise', 'Ehime Mbano', 'Ezinihitte Mbaise', 'Ideato North', 'Ideato South', 'Ihitte Uboma', 'Ikeduru', 'Isiala Mbano', 'Isu', 'Mbaitoli', 'Ngor/Okpala', 'Njaba', 'Nkwangele', 'Nkwerre', 'Obowo', 'Oguta', 'Ohaji/Egbema', 'Okigwe', 'Onuimo', 'Orlu', 'Orsu', 'Oru East', 'Oru West', 'Owerri Municipal', 'Owerri North', 'Owerri West'],
  'Jigawa': ['Auyo', 'Babura', 'Birnin Kudu', 'Birniwa', 'Buji', 'Dutse', 'Gagarawa', 'Garki', 'Gumel', 'Guri', 'Gwaram', 'Gwiwa', 'Hadejia', 'Jahun', 'Kafin Hausa', 'Kaugama', 'Kazaure', 'Kiri-Kasamma', 'Kiyawa (Jigawa)', 'Maigatari', 'Malam Madori', 'Miga', 'Ringim', 'Roni', 'Sule Takarkar', 'Taura', 'Yankwashi'],
  'Kaduna': ['Birnin Gwari', 'Chikun', 'Giwa', 'Igabi', 'Ikara', 'Jaba', 'Jema\'A', 'Kachia', 'Kaduna North', 'Kaduna South', 'Kagarko', 'Kajuru', 'Kaura', 'Kauru', 'Kubau', 'Kudan', 'Lere', 'Makarfi', 'Sabon Gari', 'Sanga', 'Soba', 'Zangon Kataf', 'Zaria'],
  'Kano': ['Ajingi', 'Albasu', 'Bagwai', 'Bebeji', 'Bichi', 'Bunkure', 'Dala', 'Danbatta', 'Dawakin Kudu', 'Dawakin Tofa', 'Doguwa', 'Fagge', 'Gabasawa', 'Garko', 'Garun Mallam', 'Gaya', 'Gezawa', 'Gwale', 'Gwarzo', 'Kabo', 'Kano Municipal', 'Karaye', 'Kibiya', 'Kiru', 'Kumbotso', 'Kunchi', 'Kura', 'Madobi', 'Makoda', 'Minjibir', 'Nassarawa', 'Rano', 'Rimin Gado', 'Rogo', 'Shanono', 'Sumaila', 'Takai', 'Tarauni', 'Tofa', 'Tsanyawa', 'Tudun Wada', 'Ungogo', 'Warawa', 'Wudil'],
  'Katsina': ['Bakori', 'Batagarawa', 'Batsari', 'Baure', 'Bindawa', 'Charanchi', 'Dan-Musa', 'Dandume', 'Danja', 'Daura', 'Dutsi', 'Dutsinma', 'Faskari', 'Funtua', 'Ingawa', 'Jibia', 'Kafur', 'Kaita', 'Kankara', 'Kankia', 'Katsina', 'Kurfi', 'Kusada', 'Maiadua', 'Malumfashi', 'Mani', 'Mashi', 'Matazu', 'Musawa', 'Rimi', 'Sabuwa', 'Safana', 'Sandamu', 'Zango'],
  'Kebbi': ['Alieru', 'Arewa Dandi', 'Argungu', 'Augie', 'Bagudo', 'Birnin-Kebbi', 'Bunza', 'Dandi', 'Danko/Wasagu', 'Fakai', 'Gwandu', 'Jega', 'Kalgo', 'Koko/Besse', 'Maiyama', 'Ngaski', 'Sakaba', 'Shanga', 'Suru', 'Yauri', 'Zuru'],
  'Kogi': ['Adavi', 'Ajaokuta', 'Ankpa', 'Bassa (Kogi)', 'Dekina', 'Ibaji', 'Idah', 'Igalamela-Odolu', 'Ijumu', 'Kabba/Bunu', 'Kogi', 'Koton Karfe', 'Mopa-Muro', 'Ofu', 'Ogori/Magongo', 'Okehi', 'Okene', 'Olamaboro', 'Omala', 'Yagba East', 'Yagba West'],
  'Kwara': ['Asa', 'Baruten', 'Edu', 'Ekiti', 'Ifelodun (Kwara)', 'Ilorin East', 'Ilorin South', 'Ilorin West', 'Irepodun (Kwara)', 'Isin', 'Kai Ama', 'Moro', 'Offa', 'Oke-Ero', 'Oyun', 'Pategi'],
  'Lagos': ['Agege', 'Ajeromi/Ifelodun', 'Alimosho', 'Amowo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako/Ijaye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi/Isolo', 'Somolu', 'Surulere (Lagos)'],
  'Nasarawa': ['Akwanga', 'Awe', 'Doma', 'Karu', 'Keana', 'Keffi', 'Kokona', 'Lafia', 'Nasarawa', 'Nasarawa Eggon', 'Obi (Nassarawa)', 'Toto', 'Wamba'],
  'Niger': ['Agaie', 'Agwara', 'Bida', 'Borgu', 'Bosso', 'Chanchaga', 'Edati', 'Gbako', 'Gurara', 'Katcha', 'Kontagora', 'Lapai', 'Lavun', 'Magama', 'Mariga', 'Mashegu', 'Mokwa', 'Muya', 'Paikoro', 'Rafi', 'Rijau', 'Shiroro', 'Suleja', 'Tafa', 'Wushishi'],
  'Ogun': ['Abeokuta North', 'Abeokuta South', 'Ado-Odo/Ota', 'Ewekoro', 'Ifo', 'Ijebu East', 'Ijebu North', 'Ijebu North East', 'Ijebu Ode', 'Ikenne', 'Imeko-Afon', 'Ipokia', 'Obafemi/Owode', 'Odedah', 'Odogbolu', 'Ogun Waterside', 'Remo North', 'Shagamu', 'Yewa North', 'Yewa South'],
  'Ondo': ['Akoko North East', 'Akoko North West', 'Akoko South East', 'Akoko South West', 'Akure North', 'Akure South', 'Ese-Edo', 'Idanre', 'Ifedore', 'Ilaje', 'Ile-Oluji-Okeigbo', 'Irele', 'Odigbo', 'Okitipupa', 'Ondo East', 'Ondo West', 'Ose', 'Owo'],
  'Osun': ['Aiyedade', 'Aiyedire', 'Atakumosa East', 'Atakumosa West', 'Boluwaduro', 'Boripe', 'Ede North', 'Ede South', 'Egbedore', 'Ejigbo', 'Ife Central', 'Ife East', 'Ife North', 'Ife South', 'Ifedayo', 'Ifelodun (Osun)', 'Ila', 'Ilesha East', 'Ilesha West', 'Irepodun (Osun)', 'Irewole', 'Isokan', 'Iwo', 'Obokun', 'Odo-Otin', 'Ola-Oluwa', 'Olorunda', 'Oriade', 'Orolu', 'Osogbo'],
  'Oyo': ['Afijio', 'Akinyele', 'Atiba', 'Atisbo', 'Egbeda', 'Ibadan North', 'Ibadan North East', 'Ibadan North West', 'Ibadan South East', 'Ibadan South West', 'Ibarapa Central', 'Ibarapa East', 'Ibarapa North', 'Ido', 'Irepo', 'Iseyin', 'Itesiwaju', 'Iwajowa', 'Kajola', 'Lagelu', 'Ogbomosho North', 'Ogbomosho South', 'Ogo-Oluwa', 'Olorunsogo', 'Oluyole', 'Ona-Ara', 'Orelope', 'Ori Ire', 'Oyo East', 'Oyo West', 'Saki East', 'Saki West', 'Surulere (Oyo)'],
  'Plateau': ['Barkin Ladi', 'Bassa (Plateau)', 'Bokkos', 'Jos East', 'Jos North', 'Jos South', 'Kanam', 'Kanke', 'Langtang North', 'Langtang South', 'Mangu', 'Mikang', 'Pankshin', 'Quan-Pan', 'Riyom', 'Shendam', 'Wase'],
  'Rivers': ['Ahoada East', 'Ahoada West', 'Akukutoru', 'Andoni', 'Asaritoru', 'Bonny', 'Degema', 'Eleme', 'Emohua', 'Etche', 'Gonaka', 'Ikwerre', 'Khana', 'Obio/Akpor', 'Obua/Odual', 'Ogba/Egbema/Ndoni', 'Ogu/Bolo', 'Okrika', 'Omumma', 'Opobo/Nkoro', 'Oyigbo', 'Port Harcourt', 'Tai'],
  'Sokoto': ['Binji', 'Bodinga', 'Dange-Shuni', 'Gada', 'Goronyo', 'Gudu', 'Gwadabawa', 'Illela', 'Isa', 'Kebbe', 'Kware', 'Rabah', 'Sabon Birni', 'Shagari', 'Silame', 'Sokoto North', 'Sokoto South', 'Tambuwal', 'Tangaza', 'Tureta', 'Wamakko', 'Wurno', 'Yabo'],
  'Taraba': ['Ardo Kola', 'Bali', 'Donga', 'Gashaka', 'Gassol', 'Ibi', 'Jalingo', 'Karim Lamidu', 'Kurmi', 'Lau', 'Sardauna', 'Takum', 'Ussa', 'Wukari', 'Yorro', 'Zing'],
  'Yobe': ['Bade', 'Bursari', 'Damaturu', 'Fika', 'Fune', 'Geidam', 'Gujba', 'Gulami', 'Jakusko', 'Karasuwa', 'Machina', 'Nangere', 'Nguru', 'Potiskum', 'Tarmua', 'Yunusari', 'Yusufari'],
  'Zamfara': ['Anka', 'Bakura', 'Bukkuyum', 'Bungudu', 'Gummi', 'Gusau', 'Kaura Namoda', 'Kiyawa (Zamfara)', 'Maradun', 'Maru', 'Shinkafi', 'Talata Mafara', 'Tsafe', 'Zurmi'],
} as const;

export const nigeriaStateCenters: Record<NigeriaState, { latitude: number; longitude: number }> = {
  'Abia': { latitude: 5.532, longitude: 7.486 },
  'Adamawa': { latitude: 9.326, longitude: 12.398 },
  'Akwa Ibom': { latitude: 5.037, longitude: 7.912 },
  'Anambra': { latitude: 6.21, longitude: 7.067 },
  'Bauchi': { latitude: 10.315, longitude: 9.844 },
  'Bayelsa': { latitude: 4.926, longitude: 6.267 },
  'Benue': { latitude: 7.731, longitude: 8.539 },
  'Borno': { latitude: 11.833, longitude: 13.151 },
  'Cross River': { latitude: 4.958, longitude: 8.326 },
  'Delta': { latitude: 5.704, longitude: 5.934 },
  'Ebonyi': { latitude: 6.265, longitude: 8.013 },
  'Edo': { latitude: 6.338, longitude: 5.625 },
  'Ekiti': { latitude: 7.719, longitude: 5.311 },
  'Enugu': { latitude: 6.458, longitude: 7.546 },
  'Federal Capital Territory': { latitude: 9.0765, longitude: 7.3986 },
  'Gombe': { latitude: 10.29, longitude: 11.17 },
  'Imo': { latitude: 5.484, longitude: 7.035 },
  'Jigawa': { latitude: 12.228, longitude: 9.562 },
  'Kaduna': { latitude: 10.511, longitude: 7.438 },
  'Kano': { latitude: 12.002, longitude: 8.592 },
  'Katsina': { latitude: 12.985, longitude: 7.617 },
  'Kebbi': { latitude: 12.451, longitude: 4.197 },
  'Kogi': { latitude: 7.801, longitude: 6.739 },
  'Kwara': { latitude: 8.496, longitude: 4.542 },
  'Lagos': { latitude: 6.5244, longitude: 3.3792 },
  'Nasarawa': { latitude: 8.537, longitude: 8.322 },
  'Niger': { latitude: 9.93, longitude: 5.598 },
  'Ogun': { latitude: 7.161, longitude: 3.35 },
  'Ondo': { latitude: 7.252, longitude: 5.193 },
  'Osun': { latitude: 7.771, longitude: 4.556 },
  'Oyo': { latitude: 7.378, longitude: 3.947 },
  'Plateau': { latitude: 9.8965, longitude: 8.8583 },
  'Rivers': { latitude: 4.8156, longitude: 7.0498 },
  'Sokoto': { latitude: 13.06, longitude: 5.237 },
  'Taraba': { latitude: 7.999, longitude: 10.774 },
  'Yobe': { latitude: 11.747, longitude: 11.966 },
  'Zamfara': { latitude: 12.17, longitude: 6.664 },
} as const;

export const defaultNigeriaCoordinate = { latitude: 9.0765, longitude: 7.3986 } as const;

const normalizeNigeriaStateName = (state: string | null | undefined): NigeriaState | null => {
  if (typeof state !== 'string') {
    return null;
  }

  const trimmed = state.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();

  if (normalized === 'fct' || normalized === 'abuja' || normalized === 'fct-abuja') {
    return 'Federal Capital Territory';
  }

  if (normalized === 'nassarawa') {
    return 'Nasarawa';
  }

  return nigeriaStateOptions.find((option) => option.toLowerCase() === normalized) ?? null;
};

const getLgaOptionsForState = (state: string | null | undefined): readonly string[] => {
  const normalizedState = normalizeNigeriaStateName(state);
  if (!normalizedState) {
    return [];
  }

  return nigeriaLgaOptionsByState[normalizedState] ?? [];
};

const getNigeriaAreaCoordinate = (
  state: string | null | undefined,
  lga?: string | null
): { latitude: number; longitude: number } => {
  const normalizedState = normalizeNigeriaStateName(state);
  const center = (normalizedState && nigeriaStateCenters[normalizedState]) || defaultNigeriaCoordinate;

  if (!normalizedState || !lga) {
    return center;
  }

  const lgas = getLgaOptionsForState(normalizedState);
  const index = lgas.findIndex((candidate: string) => candidate.toLowerCase() === String(lga).trim().toLowerCase());

  if (index < 0 || lgas.length <= 1) {
    return center;
  }

  const angle = (index / lgas.length) * Math.PI * 2;
  const radius = 0.08 + (index % 5) * 0.012;

  return {
    latitude: Number((center.latitude + Math.sin(angle) * radius).toFixed(6)),
    longitude: Number((center.longitude + Math.cos(angle) * radius).toFixed(6)),
  };
};

export { getLgaOptionsForState, getNigeriaAreaCoordinate, normalizeNigeriaStateName };

'use strict';
// Sri Lanka administrative structure: Province -> District -> City/Town.
// Admin can extend via the admin API / site settings.

const PROVINCES = [
  ['Western', [
    ['Colombo', ['Colombo', 'Sri Jayawardenepura Kotte', 'Dehiwala-Mount Lavinia', 'Moratuwa', 'Maharagama', 'Kesbewa', 'Kaduwela', 'Kolonnawa', 'Avissawella', 'Padukka', 'Hanwella']],
    ['Gampaha', ['Gampaha', 'Negombo', 'Kadawatha', 'Kelaniya', 'Wattala', 'Ja-Ela', 'Seeduwa', 'Katunayake', 'Veyangoda', 'Mirigama', 'Divulapitiya']],
    ['Kalutara', ['Kalutara', 'Panadura', 'Horana', 'Beruwala', 'Wadduwa', 'Kalutara South', 'Matugama', 'Bandaragama', 'Aluthgama']],
  ]],
  ['Central', [
    ['Kandy', ['Kandy', 'Peradeniya', 'Katugastota', 'Akurana', 'Gampola', 'Nawalapitiya', 'Kadugannawa', 'Wattegama']],
    ['Matale', ['Matale', 'Dambulla', 'Sigiriya', 'Ukuwela']],
    ['Nuwara Eliya', ['Nuwara Eliya', 'Hatton', 'Talawakele', 'Maskeliya']],
  ]],
  ['Southern', [
    ['Galle', ['Galle', 'Ambalangoda', 'Hikkaduwa', 'Bentota', 'Elpitiya', 'Karapitiya', 'Unawatuna']],
    ['Matara', ['Matara', 'Weligama', 'Mirissa', 'Dikwella', 'Akuressa', 'Hakmana']],
    ['Hambantota', ['Hambantota', 'Tangalle', 'Ambalantota', 'Tissamaharama', 'Beliatta']],
  ]],
  ['Northern', [
    ['Jaffna', ['Jaffna', 'Chavakachcheri', 'Point Pedro', 'Valvettithurai']],
    ['Kilinochchi', ['Kilinochchi']],
    ['Mannar', ['Mannar', 'Talaimannar']],
    ['Mullaitivu', ['Mullaitivu', 'Puthukkudiyiruppu']],
    ['Vavuniya', ['Vavuniya', 'Nedunkeni']],
  ]],
  ['Eastern', [
    ['Trincomalee', ['Trincomalee', 'Kinniya', 'Mutur']],
    ['Batticaloa', ['Batticaloa', 'Kattankudy', 'Eravur', 'Valaichchenai']],
    ['Ampara', ['Ampara', 'Kalmunai', 'Akkaraipattu', 'Sainthamaruthu']],
  ]],
  ['North Western', [
    ['Kurunegala', ['Kurunegala', 'Kuliyapitiya', 'Narammala', 'Wariyapola', 'Mawathagama', 'Dambadeniya']],
    ['Puttalam', ['Puttalam', 'Chilaw', 'Wennappuwa', 'Marawila', 'Dankotuwa']],
  ]],
  ['North Central', [
    ['Anuradhapura', ['Anuradhapura', 'Kekirawa', 'Kebithigollewa']],
    ['Polonnaruwa', ['Polonnaruwa', 'Hingurakgoda', 'Kaduruwela']],
  ]],
  ['Uva', [
    ['Badulla', ['Badulla', 'Bandarawela', 'Ella', 'Haputale', 'Welimada']],
    ['Moneragala', ['Moneragala', 'Wellawaya', 'Bibile', 'Kataragama']],
  ]],
  ['Sabaragamuwa', [
    ['Ratnapura', ['Ratnapura', 'Balangoda', 'Embilipitiya', 'Pelmadulla', 'Kuruwita']],
    ['Kegalle', ['Kegalle', 'Mawanella', 'Warakapola', 'Rambukkana']],
  ]],
];

module.exports = { PROVINCES };

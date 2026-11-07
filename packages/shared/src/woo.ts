/**
 * WooCommerce's own codes for Bangladesh's 64 districts, for the WooCommerce migration (roadmap
 * phases 21–22): `BD-01` is Bandarban, `BD-13` Dhaka, `BD-64` Thakurgaon. They follow
 * WooCommerce's `i18n/states.php`, which numbers the districts by their English names; they are
 * NOT the BBS codes bd-geo uses. The importer maps imported addresses with them (the names are
 * then matched against bd-geo's aliases), and the merchant admin shows old orders' districts.
 */
export const WOO_BD_DISTRICTS = [
    'Bandarban',
    'Barguna',
    'Bogura',
    'Brahmanbaria',
    'Bagerhat',
    'Barishal',
    'Bhola',
    'Cumilla',
    'Chandpur',
    'Chattogram',
    "Cox's Bazar",
    'Chuadanga',
    'Dhaka',
    'Dinajpur',
    'Faridpur',
    'Feni',
    'Gopalganj',
    'Gazipur',
    'Gaibandha',
    'Habiganj',
    'Jamalpur',
    'Jashore',
    'Jhenaidah',
    'Joypurhat',
    'Jhalokati',
    'Kishoreganj',
    'Khulna',
    'Kurigram',
    'Khagrachhari',
    'Kushtia',
    'Lakshmipur',
    'Lalmonirhat',
    'Manikganj',
    'Mymensingh',
    'Munshiganj',
    'Madaripur',
    'Magura',
    'Moulvibazar',
    'Meherpur',
    'Narayanganj',
    'Netrakona',
    'Narsingdi',
    'Narail',
    'Natore',
    'Nawabganj',
    'Nilphamari',
    'Noakhali',
    'Naogaon',
    'Pabna',
    'Pirojpur',
    'Patuakhali',
    'Panchagarh',
    'Rajbari',
    'Rajshahi',
    'Rangpur',
    'Rangamati',
    'Sherpur',
    'Satkhira',
    'Sirajganj',
    'Sylhet',
    'Sunamganj',
    'Shariatpur',
    'Tangail',
    'Thakurgaon',
] as const;

/**
 * The district name for a WooCommerce state code: `BD-13` (an address) or `BD:BD-13` (a shipping
 * zone region) is "Dhaka". Null for anything else (a typed-in name, another country's state).
 */
export function wooDistrictName(state: string): string | null {
    const match = /^(?:BD:)?BD-(\d\d)$/.exec(state.trim());
    return (match && WOO_BD_DISTRICTS[Number(match[1]) - 1]) || null;
}

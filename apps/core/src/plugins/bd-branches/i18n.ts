/** Branch messages (`message.bd-branches.<key>`). Terms follow docs/glossary.md. */
const en = {
    'not-found': 'That branch or transfer could not be found.',
    phone: 'That phone number is not a Bangladeshi number.',
    district: 'Choose a district.',
    thana: 'Choose a thana in that district.',
    'has-stock': 'This branch still has stock. Move it out before deleting the branch.',
    'has-history': 'This branch has already held stock, so it can’t be deleted.',
    last: 'The store needs at least one branch.',
    'open-transfer': 'A transfer to or from this branch is still on the way.',
    'same-branch': 'Choose two different branches.',
    'not-enough': 'That branch doesn’t have that many free units.',
    promised: 'Those units are already in an order. Send what is free, or ship the order first.',
    'too-many': 'You can only receive what was sent and has not arrived yet.',
    nothing: 'Enter how many to send or receive.',
    variant: 'One of the products could not be found.',
};

const bn: typeof en = {
    'not-found': 'এই শাখা বা স্টক ট্রান্সফার খুঁজে পাওয়া যায়নি।',
    phone: 'এই ফোন নম্বরটি বাংলাদেশের নয়।',
    district: 'জেলা বেছে নিন।',
    thana: 'এই জেলার একটি থানা বেছে নিন।',
    'has-stock': 'এই শাখায় এখনও স্টক আছে। মুছে ফেলার আগে স্টক সরিয়ে নিন।',
    'has-history': 'এই শাখায় আগে স্টক ছিল, তাই মুছে ফেলা যায় না।',
    last: 'স্টোরে অন্তত একটি শাখা থাকতে হবে।',
    'open-transfer': 'এই শাখার একটি স্টক ট্রান্সফার এখনও পথে আছে।',
    'same-branch': 'দুটি আলাদা শাখা বেছে নিন।',
    'not-enough': 'এই শাখায় এত খালি পিস নেই।',
    promised: 'এই পিসগুলো ইতিমধ্যে একটি অর্ডারে আছে। যেগুলো খালি, সেগুলো পাঠান, অথবা আগে অর্ডারটি পাঠান।',
    'too-many': 'যত পাঠানো হয়েছে এবং এখনও পৌঁছায়নি, শুধু সেটাই নিতে পারবেন।',
    nothing: 'কত পিস পাঠাবেন বা নেবেন লিখুন।',
    variant: 'একটি পণ্য খুঁজে পাওয়া যায়নি।',
};

export const branchTranslations = {
    en: { message: { 'bd-branches': en } },
    bn: { message: { 'bd-branches': bn } },
};

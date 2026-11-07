<?php // phpcs:ignore WordPress.Files.FileName.NotHyphenatedLowercase -- WordPress loads translations by this exact name.
/**
 * Bangla text for the helper, in WordPress's PHP translation format (".l10n.php").
 *
 * WordPress 6.5+ loads this file by itself for the bn_BD locale. On older versions
 * EcommBD_Migrator_I18n::fallback() reads it. Keys are the exact English text in the code;
 * tests/strings.php fails if one is missing or its placeholders differ.
 * Terms follow docs/glossary.md (কাস্টমার, ক্যাটাগরি, স্টোর সেটিংস…).
 *
 * @package EcommBD_Migrator
 */

defined( 'ABSPATH' ) || exit;

return array(
	'domain'       => 'ecommbd-migrator',
	'language'     => 'bn_BD',
	'plural-forms' => 'nplurals=2; plural=(n != 1);',
	'messages'     => array(
		'%s ago'                                   => '%s আগে',
		'An upload is running right now. Wait a minute, then try again.' => 'এই মুহূর্তে একটি আপলোড চলছে। এক মিনিট অপেক্ষা করে আবার চেষ্টা করুন।',
		'Background uploads are off on this site (WordPress cron is disabled). Click "Continue now" until the upload is complete.' => 'এই সাইটে ব্যাকগ্রাউন্ডে আপলোড বন্ধ আছে (WordPress cron বন্ধ)। আপলোড শেষ না হওয়া পর্যন্ত "এখনই চালিয়ে যান" চাপুন।',
		'Cancel'                                   => 'বাতিল',
		'Categories'                               => 'ক্যাটাগরি',
		'Check pairing details'                    => 'পেয়ারিং তথ্য যাচাই করুন',
		'Check where your store data will go'      => 'আপনার স্টোরের তথ্য কোথায় যাবে, দেখে নিন',
		'Code: %s'                                 => 'কোড: %s',
		'Confirm and start the upload'             => 'নিশ্চিত করে আপলোড শুরু করুন',
		'Confirm the destination store before the upload can continue.' => 'আপলোড চালিয়ে যাওয়ার আগে গন্তব্য স্টোরটি নিশ্চিত করুন।',
		'Connect to Ecomm BD'                      => 'Ecomm BD-এর সাথে যুক্ত করুন',
		'Continue'                                 => 'চালিয়ে যান',
		'Continue now'                             => 'এখনই চালিয়ে যান',
		'Continue only if this is the address of your own Ecomm BD store, as shown in your Ecomm BD admin. If someone sent you these pairing details, stop and contact Ecomm BD support.' => 'এটি আপনার নিজের Ecomm BD স্টোরের ঠিকানা হলে (আপনার Ecomm BD অ্যাডমিনে যেমন দেখায়) তবেই এগোন। কেউ আপনাকে এই পেয়ারিং তথ্য পাঠিয়ে থাকলে থামুন এবং Ecomm BD সাপোর্টে যোগাযোগ করুন।',
		'Could not reach Ecomm BD over a secure connection. A security plugin (such as Wordfence) or the host may block outgoing requests; ask them to allow your Ecomm BD address. The helper tries again by itself a few times.' => 'নিরাপদ সংযোগে Ecomm BD-তে পৌঁছানো যায়নি। কোনো সিকিউরিটি প্লাগইন (যেমন Wordfence) বা হোস্ট বাইরের রিকোয়েস্ট আটকাতে পারে; আপনার Ecomm BD ঠিকানাটি অনুমতি দিতে তাদের বলুন। হেল্পার নিজে থেকে কয়েকবার আবার চেষ্টা করবে।',
		'Coupons'                                  => 'কুপন',
		'Create them on the migration page of your Ecomm BD admin. They work once, for one hour.' => 'আপনার Ecomm BD অ্যাডমিনের মাইগ্রেশন পেজে এটি তৈরি করুন। এটি একবারই কাজ করে, এক ঘণ্টার জন্য।',
		'Customers'                                => 'কাস্টমার',
		'Deletes the saved token and progress from this site. Your store data here is not touched.' => 'এই সাইট থেকে সেভ করা টোকেন ও অগ্রগতি মুছে দেয়। এখানে আপনার স্টোরের তথ্যে হাত দেয় না।',
		'Destination store'                        => 'গন্তব্য স্টোর',
		'Ecomm BD expected a different part of the upload. Remove the saved connection and pair again.' => 'Ecomm BD আপলোডের অন্য একটি অংশ আশা করছিল। সেভ করা সংযোগ মুছে আবার পেয়ার করুন।',
		'Ecomm BD refused the data. The pairing may have expired or been revoked. Create new pairing details and start again.' => 'Ecomm BD তথ্য গ্রহণ করেনি। পেয়ারিংয়ের মেয়াদ শেষ হয়ে থাকতে পারে বা এটি বাতিল করা হয়ে থাকতে পারে। নতুন পেয়ারিং তথ্য তৈরি করে আবার শুরু করুন।',
		'Ecomm BD sent an unexpected answer. Try again in a few minutes.' => 'Ecomm BD অপ্রত্যাশিত উত্তর পাঠিয়েছে। কয়েক মিনিট পরে আবার চেষ্টা করুন।',
		'Finishing'                                => 'শেষ করা হচ্ছে',
		'Last activity'                            => 'শেষ কাজ',
		'Move to Ecomm BD'                         => 'Ecomm BD-তে নিন',
		'New pairing details replace the current upload and start from the beginning.' => 'নতুন পেয়ারিং তথ্য দিলে বর্তমান আপলোড বাদ দিয়ে শুরু থেকে আবার চলবে।',
		'Not allowed'                              => 'অনুমতি নেই',
		'Not confirmed yet'                        => 'এখনো নিশ্চিত করা হয়নি',
		'Nothing was sent for more than 10 minutes. Click "Continue now". If it keeps stopping, ask your host whether WordPress cron runs on this site.' => '১০ মিনিটের বেশি সময় কিছু পাঠানো হয়নি। "এখনই চালিয়ে যান" চাপুন। বারবার থেমে গেলে আপনার হোস্টকে জিজ্ঞেস করুন এই সাইটে WordPress cron চলে কি না।',
		'One record is too large to send (over 1.9 MB). Contact Ecomm BD support.' => 'একটি রেকর্ড পাঠানোর জন্য খুব বড় (১.৯ MB-এর বেশি)। Ecomm BD সাপোর্টে যোগাযোগ করুন।',
		'Orders'                                   => 'অর্ডার',
		'Pairing details from Ecomm BD'            => 'Ecomm BD থেকে পাওয়া পেয়ারিং তথ্য',
		'Part of your store was sent. The rest continues in the background.' => 'আপনার স্টোরের একটি অংশ পাঠানো হয়েছে। বাকিটা ব্যাকগ্রাউন্ডে চলতে থাকবে।',
		'Parts sent'                               => 'পাঠানো অংশ',
		'Products'                                 => 'পণ্য',
		'Progress'                                 => 'অগ্রগতি',
		'Remove saved connection'                  => 'সেভ করা সংযোগ মুছুন',
		'Reviews'                                  => 'রিভিউ',
		'Sorry, you are not allowed to move this store. Only a WooCommerce shop manager or administrator can do this.' => 'দুঃখিত, এই স্টোর সরানোর অনুমতি আপনার নেই। শুধু WooCommerce শপ ম্যানেজার বা অ্যাডমিনিস্ট্রেটর এটি করতে পারেন।',
		'Start again with new pairing details'     => 'নতুন পেয়ারিং তথ্য দিয়ে আবার শুরু করুন',
		'Step %1$s of %2$s: %3$s'                  => 'ধাপ %1$s/%2$s: %3$s',
		'Store settings'                           => 'স্টোর সেটিংস',
		'Tags'                                     => 'ট্যাগ',
		'The destination is not the one you confirmed. Paste the pairing details again and check the address.' => 'এটি আপনার নিশ্চিত করা গন্তব্য নয়। পেয়ারিং তথ্য আবার দিন এবং ঠিকানাটি মিলিয়ে দেখুন।',
		'The helper will send your products, orders, customers and customers\' password hashes to this store:' => 'হেল্পার আপনার পণ্য, অর্ডার, কাস্টমার এবং কাস্টমারদের পাসওয়ার্ড হ্যাশ এই স্টোরে পাঠাবে:',
		'The pairing details must point to a secure (https) address.' => 'পেয়ারিং তথ্যে একটি নিরাপদ (https) ঠিকানা থাকতে হবে।',
		'The person who started the upload can no longer manage WooCommerce. Pair again as a shop manager or administrator.' => 'যিনি আপলোড শুরু করেছিলেন, তিনি আর WooCommerce পরিচালনা করতে পারেন না। শপ ম্যানেজার বা অ্যাডমিনিস্ট্রেটর হিসেবে আবার পেয়ার করুন।',
		'The saved connection cannot be read, probably because the site\'s security keys changed. Remove it and pair again.' => 'সেভ করা সংযোগটি পড়া যাচ্ছে না, সম্ভবত সাইটের সিকিউরিটি কী বদলানো হয়েছে। এটি মুছে আবার পেয়ার করুন।',
		'The saved connection was removed from this site. Also revoke the helper upload token in your Ecomm BD admin.' => 'এই সাইট থেকে সেভ করা সংযোগ মুছে ফেলা হয়েছে। আপনার Ecomm BD অ্যাডমিনে হেল্পারের আপলোড টোকেনটিও বাতিল করুন।',
		'The upload continues by itself in the background. "Continue now" sends as much as fits in about 20 seconds; use it if the upload stopped or showed an error.' => 'আপলোড ব্যাকগ্রাউন্ডে নিজে থেকেই চলতে থাকে। "এখনই চালিয়ে যান" প্রায় ২০ সেকেন্ডে যতটা সম্ভব পাঠায়; আপলোড থেমে গেলে বা ভুল দেখালে এটি ব্যবহার করুন।',
		'The upload stopped. Click "Continue now" to try again.' => 'আপলোড থেমে গেছে। আবার চেষ্টা করতে "এখনই চালিয়ে যান" চাপুন।',
		'There is no saved connection. Paste new pairing details.' => 'কোনো সেভ করা সংযোগ নেই। নতুন পেয়ারিং তথ্য দিন।',
		'These pairing details are not valid. Copy them again from your Ecomm BD admin.' => 'এই পেয়ারিং তথ্য সঠিক নয়। আপনার Ecomm BD অ্যাডমিন থেকে আবার কপি করুন।',
		'This helper reads your store and sends a copy to your Ecomm BD store. It never changes products, orders, customers or passwords on this site. Remove it when the move is finished.' => 'এই হেল্পার আপনার স্টোরের তথ্য পড়ে এবং একটি কপি আপনার Ecomm BD স্টোরে পাঠায়। এই সাইটের পণ্য, অর্ডার, কাস্টমার বা পাসওয়ার্ড কখনো বদলায় না। স্টোর সরানো শেষ হলে এটি মুছে দিন।',
		'This server cannot encrypt the saved connection (PHP OpenSSL is missing). Ask your host to enable it.' => 'এই সার্ভার সেভ করা সংযোগ এনক্রিপ্ট করতে পারছে না (PHP OpenSSL নেই)। আপনার হোস্টকে এটি চালু করতে বলুন।',
		'Tick the box to confirm the destination store first.' => 'আগে বক্সে টিক দিয়ে গন্তব্য স্টোর নিশ্চিত করুন।',
		'Upload complete'                          => 'আপলোড শেষ',
		'Upload complete. Go back to your Ecomm BD admin to check and import the data. Then remove this plugin.' => 'আপলোড শেষ। তথ্য মিলিয়ে দেখে ইমপোর্ট করতে আপনার Ecomm BD অ্যাডমিনে ফিরে যান। তারপর এই প্লাগইনটি মুছে দিন।',
		'Upload progress'                          => 'আপলোডের অগ্রগতি',
		'WooCommerce 4.0 or later must be active.' => 'WooCommerce 4.0 বা পরের সংস্করণ চালু থাকতে হবে।',
		'Yes, %s is my Ecomm BD store.'            => 'হ্যাঁ, %s আমার Ecomm BD স্টোর।',
	),
);

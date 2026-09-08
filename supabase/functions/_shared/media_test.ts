import { assertEquals } from 'jsr:@std/assert';
import { rewriteImageUrl, rewriteMenuImageUrls } from './media.ts';

const config = {
  storagePublicPrefix: 'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/',
  imageCdnBaseUrl: 'https://img.feasty.com.ng',
};

Deno.test('rewrites public storage URLs to transformation URLs', () => {
  const original =
    'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg';
  assertEquals(
    rewriteImageUrl(original, config),
    'https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg'
  );
});

Deno.test('passes through non-storage URLs', () => {
  assertEquals(rewriteImageUrl('https://example.com/a.png', config), 'https://example.com/a.png');
});

Deno.test('passes through null/undefined/empty', () => {
  assertEquals(rewriteImageUrl(null, config), null);
  assertEquals(rewriteImageUrl(undefined, config), undefined);
  assertEquals(rewriteImageUrl('', config), '');
});

Deno.test('no-ops when imageCdnBaseUrl is unset', () => {
  const original =
    'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg';
  assertEquals(rewriteImageUrl(original, { ...config, imageCdnBaseUrl: '' }), original);
});

Deno.test('does not double-wrap already-transformed URLs', () => {
  const wrapped =
    'https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg';
  assertEquals(rewriteImageUrl(wrapped, config), wrapped);
});

Deno.test('rewrites storage-hosted menu item images', () => {
  const menu = [
    {
      category: 'Rice',
      items: [
        {
          id: 'jollof',
          image:
            'https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg',
          price: 3500,
        },
      ],
    },
  ];

  assertEquals(rewriteMenuImageUrls(menu, config), [
    {
      category: 'Rice',
      items: [
        {
          id: 'jollof',
          image:
            'https://img.feasty.com.ng/cdn-cgi/image/format=auto,quality=78,width=800,onerror=redirect/https://rgfbheorvtolixdcpjhy.supabase.co/storage/v1/object/public/menu/items/jollof.jpg',
          price: 3500,
        },
      ],
    },
  ]);
});

Deno.test('leaves hotlinked and missing menu images untouched', () => {
  const menu = [
    {
      category: 'Swallow',
      items: [
        { id: 'eba', image: 'https://cheflolaskitchen.com/eba.webp' },
        { id: 'amala' },
        { id: 'fufu', image: null },
      ],
    },
  ];

  assertEquals(rewriteMenuImageUrls(menu, config), menu);
});

Deno.test('passes malformed menu shapes through untouched', () => {
  assertEquals(rewriteMenuImageUrls([null, 'nope', { category: 'X' }], config), [
    null,
    'nope',
    { category: 'X' },
  ]);
  assertEquals(rewriteMenuImageUrls([{ items: 'not-an-array' }], config), [
    { items: 'not-an-array' },
  ]);
  assertEquals(rewriteMenuImageUrls([{ items: [null, 42] }], config), [{ items: [null, 42] }]);
});

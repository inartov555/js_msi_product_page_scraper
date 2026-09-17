export const msiSelectors = {
  productTitle: [
    '.product-detail h2.crop-text-2.title',
  ],

  description: [
    '.product-detail h2.crop-text-2.title + div p',
  ],

  regularPrice: [
    '#prices-old',
  ],

  currentPrice: [
    '#prices-new',
  ],

  priceWrapper: [
    '#prices-wrapper',
  ],

  productQuantity: [
    '#product_qty',
  ],

  breadcrumbs: [
    'ol.breadcrumb',
  ],

  mainImage:
    '#imagePopup',

  carouselImages:
    '#carouselImages img.product-detail-thumb-bto',

  specification: {
    tables:
      '.product-detail table.table.table-borderless',

    tableRows:
      'tr',

    tableCells:
      ':scope > th, :scope > td',
  },

  rating: [
    '#description-list-average-rating #average-rating-info',
  ],

  productIdInput:
    '#product_qty input[name="product_id"]',

  productCardLinks: [
    '.product-thumb h4 a[href]',
    '.product-thumb .caption a[href]',
    '.product-layout h4 a[href]',
    '.product-grid h4 a[href]',
    '.product-list h4 a[href]',
    '[data-product-id] a[href]',
  ],
};

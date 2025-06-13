$(document).ready(async function () {
  var $section = $("#app_review_section");
  if (!$section.length) return;

  var productId = $section.attr("product_id");
  var shop = $section.attr("shop");

  // Proxy URL (relative to the store domain)
  var proxyUrl = `/apps/review?shop=${shop}&productId=${productId}`;
  // Direct app URL as fallback
  var appUrl = `https://acm-fought-patch-thunder.trycloudflare.com/api/server?shop=${shop}&productId=${productId}`;

  // Helper to render review
  function renderReview(snippet) {
    if (snippet) {
      $section.html(`<div class="merchant-review-block"><strong>Merchant Review:</strong><p>${snippet}</p></div>`);
    } else {
      $section.html(`<div class="merchant-review-block">No review for this product yet.</div>`);
    }
  }

  // using proxy first, then fallback to app url
  try {
    let response = await fetch(proxyUrl);
    if (!response.ok) throw new Error("Proxy failed");
    let data = await response.json();
    console.log('proxy fn called ', data);
    renderReview(data.review?.snippet);
  } catch (e) {
    try {
      let response = await fetch(appUrl);
      if (!response.ok) throw new Error("App URL failed");
      let data = await response.json();
      renderReview(data.review?.snippet);
    } catch (err) {
      $section.html(`<div class="merchant-review-block">Unable to load review.</div>`);
    }
  }
});

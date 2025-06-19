import {
  Page,
  Card,
  DataTable,
  Thumbnail,
  Button,
  Modal,
  TextField,
  Select,
  InlineStack,
  BlockStack,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { useLoaderData, useLocation, useNavigate } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const PRODUCTS_PER_PAGE = 5;

const PRODUCTS_QUERY = `
  query Products($first: Int, $last: Int, $after: String, $before: String) {
    products(first: $first, last: $last, after: $after, before: $before) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        endCursor
        startCursor
      }
      edges {
        cursor
        node {
          id
          title
          featuredMedia {
            preview {
              image {
                url
              }
            }
          }
          variants(first: 5) {
            nodes {
              id
              compareAtPrice
              price
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Use after/before for cursor-based navigation
  const after = url.searchParams.get("after") || null;
  const before = url.searchParams.get("before") || null;

  // For forward (next), use first/after. For backward (prev), use last/before.
  let variables = {};
  if (after) {
    variables = { first: PRODUCTS_PER_PAGE, after };
  } else if (before) {
    variables = { last: PRODUCTS_PER_PAGE, before };
  } else {
    variables = { first: PRODUCTS_PER_PAGE };
  }

  // Fetch products
  const response = await admin.graphql(PRODUCTS_QUERY, { variables });
  const result = await response.json();
  const shop = session.shop;

  // Fetch reviews for this shop
  const reviews = await prisma.review.findMany({
    where: { shop },
    select: { productId: true, snippet: true },
  });

  // Map productId to snippet for quick lookup
  const reviewMap = {};
  reviews.forEach((r) => {
    reviewMap[r.productId] = r.snippet;
  });

  // Attach review to each product node
  const productsWithReviews = result.data.products.edges.map((edge) => ({
    ...edge.node,
    review: reviewMap[edge.node.id] || "",
    cursor: edge.cursor,
  }));

  return {
    products: productsWithReviews,
    shop,
    pageInfo: result.data.products.pageInfo,
  };
}

export default function HomePage() {
  const {
    products: initialProducts,
    shop,
    pageInfo: initialPageInfo,
  } = useLoaderData();

  const [products, setProducts] = useState(initialProducts);
  const [pageInfo, setPageInfo] = useState(initialPageInfo);

  console.log("page infor data ", pageInfo);
  const [loadingPage, setLoadingPage] = useState(false);

  const [activeModal, setActiveModal] = useState(null);
  const [priceInput, setPriceInput] = useState("");
  const [reviewInput, setReviewInput] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState({});
  const [loading, setLoading] = useState(false);
  const [updateResult, setUpdateResult] = useState(null);
  const [reviewResult, setReviewResult] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();
  console.log("current location is ", location);

  // Open/close modals
  const handleOpenModal = (type, product, variant) => {
    setActiveModal({ type, product, variant });
    if (type === "price") setPriceInput(variant.price);
    if (type === "review") {
      const currentReview =
        products.find((p) => p.id === product.id)?.review || "";
      setReviewInput(currentReview);
    }
  };
  const handleCloseModal = () => setActiveModal(null);

  // Update price via backend API
  const handleUpdatePrice = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          productId: activeModal.product.id,
          variantId: activeModal.variant.id,
          price: priceInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to update price");
      } else {
        setUpdateResult({
          variantId: activeModal.variant.id,
          price: priceInput,
          productId: activeModal.product.id,
        });
      }
    } catch (err) {
      alert("Error updating price: " + err.message);
    }
    setLoading(false);
    handleCloseModal();
  };

  const handleAddReview = async () => {
    if (!reviewInput.trim()) {
      alert("Review cannot be empty.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop,
          productId: activeModal.product.id,
          reviewSnippet: reviewInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to add review");
      } else {
        setReviewResult({
          productId: activeModal.product.id,
          snippet: data.review.snippet,
        });
      }
    } catch (err) {
      alert("Error adding review: " + err.message);
    }
    setLoading(false);
    handleCloseModal();
  };

  // Update product price in local state after successful update
  useEffect(() => {
    if (updateResult) {
      setProducts((prevProducts) =>
        prevProducts.map((product) => {
          if (product.id === updateResult.productId) {
            return {
              ...product,
              variants: {
                ...product.variants,
                nodes: product.variants.nodes.map((variant) =>
                  variant.id === updateResult.variantId
                    ? { ...variant, price: updateResult.price }
                    : variant,
                ),
              },
            };
          }
          return product;
        }),
      );
      setUpdateResult(null);
    }
  }, [updateResult]);

  // Update the review in local state after successful update
  useEffect(() => {
    if (reviewResult) {
      setProducts((prevProducts) =>
        prevProducts.map((product) =>
          product.id === reviewResult.productId
            ? { ...product, review: reviewResult.snippet }
            : product,
        ),
      );
      setReviewResult(null);
    }
  }, [reviewResult]);

  // Fetch products for next/previous page using cursor
  const goToPage = async (direction) => {
    setLoadingPage(true);
    let url = "/api/products?";
    // If your API requires the shop param, add it here:
    url += `shop=${encodeURIComponent(shop)}&`;

    if (direction === "next" && pageInfo.hasNextPage) {
      url += `after=${encodeURIComponent(pageInfo.endCursor)}`;
    } else if (direction === "prev" && pageInfo.hasPreviousPage) {
      url += `before=${encodeURIComponent(pageInfo.startCursor)}`;
    } else {
      setLoadingPage(false);
      return;
    }

    const res = await fetch(url);
    const data = await res.json();
    setProducts(data.products);
    setPageInfo(data.pageInfo);
    setLoadingPage(false);
  };

  const rows = products.map((product) => {
    const variants = product.variants.nodes;
    const selectedId = selectedVariantId[product.id] || variants[0]?.id;
    const selectedVariant =
      variants.find((v) => v.id === selectedId) || variants[0];
    return [
      product.title,
      product.featuredMedia?.preview?.image?.url ? (
        <Thumbnail
          source={product.featuredMedia.preview.image.url}
          alt={product.title}
          size="small"
        />
      ) : (
        "-"
      ),
      selectedVariant?.price || "-",
      variants.length > 1 ? (
        <Select
          options={variants.map((v) => ({
            label: v.id.split("/").pop(),
            value: v.id,
          }))}
          value={selectedId}
          onChange={(value) =>
            setSelectedVariantId((prev) => ({ ...prev, [product.id]: value }))
          }
        />
      ) : (
        "-"
      ),
      <InlineStack gap="200">
        <Button
          size="slim"
          onClick={() => handleOpenModal("price", product, selectedVariant)}
        >
          Update Price
        </Button>
        <Button
          size="slim"
          onClick={() => handleOpenModal("review", product, selectedVariant)}
        >
          Add Review
        </Button>
      </InlineStack>,
    ];
  });

  const paginationButtons = (
    <div style={{ textAlign: "center", margin: "20px 0" }}>
      <Button
        onClick={() => goToPage("prev")}
        disabled={!pageInfo.hasPreviousPage || loadingPage}
        loading={loadingPage}
        style={{ margin: "0 4px" }}
      >
        Previous
      </Button>
      <Button
        onClick={() => goToPage("next")}
        disabled={!pageInfo.hasNextPage || loadingPage}
        loading={loadingPage}
        style={{ margin: "0 4px" }}
      >
        Next
      </Button>
    </div>
  );

  return (
    <Page title="Product Page Editor">
      <Card>
        <DataTable
          columnContentTypes={["text", "text", "text", "text", "text"]}
          headings={["Title", "Image", "Price", "Variant", "Actions"]}
          rows={rows}
        />
        {paginationButtons}
      </Card>

      {/* Update Price Modal */}
      <Modal
        open={activeModal?.type === "price"}
        onClose={handleCloseModal}
        title="Update Variant Price"
        primaryAction={{
          content: loading ? "Updating..." : "Update",
          onAction: handleUpdatePrice,
          disabled: loading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <TextField
              label="New Price"
              value={priceInput}
              onChange={setPriceInput}
              type="number"
              autoFocus
              disabled={loading}
            />
            <div>
              <b>Variant ID:</b> {activeModal?.variant?.id}
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Add Review Modal */}
      <Modal
        open={activeModal?.type === "review"}
        onClose={handleCloseModal}
        title="Add Review Snippet"
        primaryAction={{
          content: "Add Review",
          onAction: handleAddReview,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: handleCloseModal,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <TextField
              label="Review"
              value={reviewInput}
              onChange={setReviewInput}
              multiline
              autoFocus
              placeholder={
                products.find((p) => p.id === activeModal?.product?.id)
                  ?.review || "Enter your review..."
              }
              helpText={
                products.find((p) => p.id === activeModal?.product?.id)?.review
                  ? `Current review: ${products.find((p) => p.id === activeModal?.product?.id)?.review}`
                  : undefined
              }
            />
            <div>
              <b>Product ID:</b> {activeModal?.product?.id}
            </div>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

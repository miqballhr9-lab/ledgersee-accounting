export function formatCustomerAddress(data: Record<string, string>, prefix = "") {
  const address = data[prefix ? "shippingAddress" : "address"]?.trim();
  const addressLine2 = data[prefix ? "shippingAddressLine2" : "addressLine2"]?.trim();
  const city = data[prefix ? "shippingCity" : "city"]?.trim();
  const state = data[prefix ? "shippingState" : "state"]?.trim();
  const postalCode = data[prefix ? "shippingPostalCode" : "postalCode"]?.trim();
  const country = data[prefix ? "shippingCountry" : "country"]?.trim();
  const locality = [city, state, postalCode].filter(Boolean).join(", ");
  return [address, addressLine2, locality, country].filter(Boolean).join("\n");
}

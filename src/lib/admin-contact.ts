const ADMIN_CONTACT_EMAIL = process.env.NEXT_PUBLIC_ADMIN_CONTACT_EMAIL?.trim() || "";
const ADMIN_WHATSAPP = process.env.NEXT_PUBLIC_ADMIN_WHATSAPP?.trim() || "";

export function getAdminContact() {
  const whatsappNumber = ADMIN_WHATSAPP.replace(/\D/g, "");
  return {
    email: ADMIN_CONTACT_EMAIL || null,
    whatsappUrl: whatsappNumber ? `https://wa.me/${whatsappNumber}` : null,
  };
}
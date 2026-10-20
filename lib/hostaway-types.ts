
export type HostawayReservation = {
  id: string;
  listingId: string;
  propertyName: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  guestCount: number;
  bookingReference: string;
  arrivalDate: string;
  departureDate: string;
  channelName: string;
  status: string;
  grossRevenuePence: number;
  cleaningFeePence: number;
};

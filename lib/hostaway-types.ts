export type HostawayProperty = {
  id: string;
  name: string;
  address: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  accessCode: string;
  accessInfo: string;
  guidebookUrl: string;
  listingLinks: Array<{ label: string; url: string }>;
  status: string;
};

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

export type HostawayCalendarRate = {
  date: string;
  pricePence: number;
  available: boolean;
};

export type HostawayReview = {
  id: string;
  listingId: string;
  propertyName: string;
  channelName: string;
  rating: number;
  text: string;
  createdAt: string;
  reviewUrl: string;
};

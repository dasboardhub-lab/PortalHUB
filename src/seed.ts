import type { Category, PortalLink } from "./types";
export const initialCategories: Category[] = [
  {id:"apps",name:"Aplikasi & sistem",description:"Semua sistem yang mendukung pekerjaan tim.",icon:"grid",sortOrder:0},
  {id:"reports",name:"Laporan operasional",description:"Laporan harian, inbound, dan outbound dalam satu tempat.",icon:"chart",sortOrder:1},
  {id:"monitoring",name:"Tim & monitoring",description:"Pantau progres paket dan tindak lanjuti kendala operasional.",icon:"scan",sortOrder:2},
  {id:"handover",name:"Serah terima",description:"Akses formulir dan pencatatan serah terima tim.",icon:"handover",sortOrder:3},
  {id:"docs",name:"Dokumen & SOP",description:"Panduan dan dokumen kerja yang dibutuhkan tim.",icon:"book",sortOrder:4},
];
function item(id:string,title:string,description:string,category:string,icon:string,color:string,options:Partial<PortalLink>={}):PortalLink {
  return {id,title,description,category,icon,color,group:"",hub:"ALL",status:"ready",actions:[{label:"Buka akses",url:""}],pinned:false,sortOrder:0,updatedAt:new Date().toISOString(),...options};
}
export const initialLinks:PortalLink[] = [
  item("aware","Aware Web","Sistem utama proses dan pelacakan operasional.","apps","globe","red",{pinned:true}),
  item("hcaja","HCAja","Layanan Human Capital dan administrasi karyawan.","apps","users","blue"),
  item("service-desk","Service Desk","Tiket bantuan IT dan kendala sistem.","apps","headset","purple"),
  item("guardian","Guardian","Akses proses pickup dan delivery.","apps","shield","teal"),
  item("pendopo","Pendopo","Portal informasi dan kebutuhan internal.","apps","grid","orange"),
  item("lifemobile","LifeMobile","Dashboard dan layanan mobile tim.","apps","chart","purple"),
  item("symphonia","Symphonia","Sistem manajemen dan informasi terpadu.","apps","globe","blue"),
  item("belajar-aja","Belajar Aja","Materi pembelajaran dan pengembangan tim.","apps","book","green"),
  item("daily","Report Daily","Input dan rekap laporan operasional harian.","reports","clipboard","blue",{group:"Daily",pinned:true}),
  item("5r","5R HUB","Checklist kebersihan, kerapian, dan kondisi HUB.","reports","clipboard","green",{group:"Daily"}),
  item("productivity","Produktivitas","Monitoring beban kerja dan produktivitas tim.","reports","chart","purple",{group:"Daily",pinned:true,actions:[{label:"Master data",url:""},{label:"Dashboard",url:""}]}),
  item("3pl","Laporan 3PL","Pencatatan dan monitoring pengiriman pihak ketiga.","reports","truck","orange",{group:"Daily"}),
  item("inbound-recap","Rekap Data Inbound","Rekap paket inbound yang diterima di destinasi.","reports","package","green",{group:"Inbound"}),
  ...["MKS","BPP","BJM","PLK","MND"].map(hub=>item("inbound-"+hub,"Inbound HUB "+hub,"Input dan monitoring penerimaan paket HUB "+hub+".","reports","package","green",{group:"Inbound",hub})),
  ...["MKS","BPP","BJM","PLK","MND"].map(hub=>item("outbound-"+hub,"Pre-Alert HUB "+hub,"Data keberangkatan dan pre-alert pengiriman HUB "+hub+".","reports","truck","orange",{group:"Outbound",hub,pinned:hub==="MKS",actions:[{label:"Data pre-alert",url:""},{label:"Report pre-alert",url:""}]})),
  item("stuck","Parcel Stuck HUB","Pantau paket tertahan tanpa perpindahan opcode.","monitoring","package","red",{pinned:true,actions:[{label:"Buka monitoring",url:"https://parcelstuck.vercel.app"}]}),
  item("opcode","Kelengkapan Opcode","Validasi kelengkapan scan pada alur paket.","monitoring","scan","blue",{actions:[{label:"Resource",url:""},{label:"Rekapan",url:""}]}),
  item("inprogress","Parcel Inprogress","Monitoring progres paket dan rekap bulanan.","monitoring","clock","teal",{actions:[{label:"Master data",url:""},{label:"Dashboard",url:""}]}),
  item("picapa","PICAPA","Pencatatan kasus dan tindak lanjut operasional.","monitoring","clipboard","purple"),
  item("return","Retur Mitra Pengusaha","Monitoring paket retur dari mitra pengusaha.","monitoring","handover","red"),
  item("xrt","Monitoring XRT","Pemantauan paket XRT di staging under HUB.","monitoring","scan","orange"),
  item("handover-shift","Serah Terima Shift","Catatan pergantian shift dan pekerjaan lanjutan.","handover","handover","teal",{pinned:true}),
  item("handover-mks","Handover HUB MKS","Formulir serah terima operasional HUB MKS.","handover","clipboard","blue",{hub:"MKS"}),
  item("sop","SOP Operasional","Panduan proses dan standar kerja tim HUB.","docs","book","orange"),
  item("documents","Document Center","Arsip dokumen dan formulir kebutuhan operasional.","docs","file","blue"),
].map((link,i)=>({...link,sortOrder:i}));

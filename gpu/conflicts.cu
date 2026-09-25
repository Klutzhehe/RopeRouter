// Finite-width segment and through-via conflicts. One CUDA thread per route pair.
// Double precision, no fast-math/FMA contraction. Near-threshold results are
// marked 2 so the original TypeScript predicate makes the final classification.
#include <math.h>

__device__ double point_segment(double x, double y, const double* s) {
    double dx=s[2]-s[0], dy=s[3]-s[1], d=dx*dx+dy*dy;
    double t=d ? fmax(0.0,fmin(1.0,((x-s[0])*dx+(y-s[1])*dy)/d)) : 0.0;
    return hypot(x-(s[0]+t*dx),y-(s[1]+t*dy));
}
__device__ double cross(double ax,double ay,double bx,double by,double cx,double cy) {
    return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
}
__device__ double segment_distance(const double* a,const double* b) {
    double ab1=cross(a[0],a[1],a[2],a[3],b[0],b[1]);
    double ab2=cross(a[0],a[1],a[2],a[3],b[2],b[3]);
    double cd1=cross(b[0],b[1],b[2],b[3],a[0],a[1]);
    double cd2=cross(b[0],b[1],b[2],b[3],a[2],a[3]);
    if (((ab1>0&&ab2<0)||(ab1<0&&ab2>0))&&((cd1>0&&cd2<0)||(cd1<0&&cd2>0)))return 0.0;
    return fmin(fmin(point_segment(a[0],a[1],b),point_segment(a[2],a[3],b)),
                fmin(point_segment(b[0],b[1],a),point_segment(b[2],b[3],a)));
}
__device__ unsigned char classify(double distance,double required) {
    double threshold=required-1e-7;
    if (fabs(distance-threshold)<=1e-5)return 2;
    return distance<threshold?1:0;
}
__device__ unsigned char route_pair(
    int a,int b,const double* segments,const int* counts,const double* widths,
    const double* vias,const int* via_counts,const int* owners,double clearance) {
    if(owners[a]==owners[b])return 0;
    const double* as=segments+a*31*5;
    const double* bs=segments+b*31*5;
    double req=(widths[a]+widths[b])/2.0+clearance;
    for(int i=0;i<counts[a];i++)for(int j=0;j<counts[b];j++){
        const double* u=as+i*5;const double* v=bs+j*5;
        if(u[4]!=v[4])continue;
        if(fmax(u[0],u[2])+req<fmin(v[0],v[2])||fmax(v[0],v[2])+req<fmin(u[0],u[2])||
           fmax(u[1],u[3])+req<fmin(v[1],v[3])||fmax(v[1],v[3])+req<fmin(u[1],u[3]))continue;
        unsigned char result=classify(segment_distance(u,v),req);if(result)return result;
    }
    for(int side=0;side<2;side++){
        int x=side?b:a,y=side?a:b;
        const double* vs=vias+x*30*3;const double* es=segments+y*31*5;
        for(int i=0;i<via_counts[x];i++){
            const double* v=vs+i*3;double margin=v[2]+widths[y]/2.0+clearance;
            for(int j=0;j<counts[y];j++){
                const double* s=es+j*5;
                if(v[0]<fmin(s[0],s[2])-margin||v[0]>fmax(s[0],s[2])+margin||
                   v[1]<fmin(s[1],s[3])-margin||v[1]>fmax(s[1],s[3])+margin)continue;
                unsigned char result=classify(point_segment(v[0],v[1],s),margin);if(result)return result;
            }
        }
    }
    for(int i=0;i<via_counts[a];i++)for(int j=0;j<via_counts[b];j++){
        const double* u=vias+(a*30+i)*3;const double* v=vias+(b*30+j)*3;
        double margin=u[2]+v[2]+clearance;
        if(fabs(u[0]-v[0])>=margin||fabs(u[1]-v[1])>=margin)continue;
        unsigned char result=classify(hypot(u[0]-v[0],u[1]-v[1]),margin);if(result)return result;
    }
    return 0;
}
extern "C" __global__ void conflict_matrix(
    const double* segments,const int* counts,const double* widths,
    const double* vias,const int* via_counts,const int* owners,
    const int* candidates,const int* others,int rows,int columns,double clearance,
    unsigned char* output) {
    int index=blockIdx.x*blockDim.x+threadIdx.x;
    if(index>=rows*columns)return;
    output[index]=route_pair(candidates[index/columns],others[index%columns],segments,counts,widths,vias,via_counts,owners,clearance);
}

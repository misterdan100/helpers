export const getUserLocation = async (): Promise<[number, number]> => {

    return new Promise((resolve, reject) => {
        // navigator.getlocation ask to user for allow location
        navigator.geolocation.getCurrentPosition(
            // if location is available
            ({coords}) => {
                resolve([coords.longitude, coords.latitude])
            },
            // if there is an error
            (err) => {
                alert('Failed to get geolocation')
                console.log(err.message)
                reject()
            }
        )
    })

}
